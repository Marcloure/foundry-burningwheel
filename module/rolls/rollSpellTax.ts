import { Ability, BWActor, TracksTests } from "../actor.js";
import { BWActorSheet } from "../bwactor-sheet.js";
import * as helpers from "../helpers.js";
import {
    buildDiceSourceObject,
    buildRerollData,
    extractBaseData,
    getRollNameClass,
    RerollData,
    RollChatMessageData,
    RollDialogData,
    rollDice,
    templates
} from "./rolls.js";

export async function handleSpellTaxRoll(target: HTMLButtonElement, sheet: BWActorSheet): Promise<unknown> {
    const obstacle = parseInt(target.dataset.obstacle || "0");
    const spellName = target.dataset.rollableName || "Unknown Spell";

    if (!obstacle && !spellName) {
        return helpers.notifyError("Missing Spell Data", "Tried to roll a tax test with no obstacle or spell name set.");
    }
    else return showSpellTaxDialog(obstacle, spellName, sheet);
}

export async function showSpellTaxDialog(obstacle: number, spellName: string, sheet: BWActorSheet): Promise<unknown> {
    const stat = getProperty(sheet.actor.data, "data.forte") as Ability;
    const actor = sheet.actor as BWActor;
    
    const rollModifiers = sheet.actor.getRollModifiers("forte");
    const tax = actor.data.data.forteTax;
    
    const data: StatDialogData = {
        name: `${spellName} Tax Test`,
        difficulty: obstacle,
        bonusDice: 0,
        arthaDice: 0,
        woundDice: actor.data.data.ptgs.woundDice,
        obPenalty: actor.data.data.ptgs.obPenalty,
        stat,
        tax,
        optionalDiceModifiers: rollModifiers.filter(r => r.optional && r.dice),
        optionalObModifiers: rollModifiers.filter(r => r.optional && r.obstacle)
    };

    const html = await renderTemplate(templates.statDialog, data);
    return new Promise(_resolve =>
        new Dialog({
            title: `${spellName} Tax Test`,
            content: html,
            buttons: {
                roll: {
                    label: "Roll",
                    callback: async (dialogHtml: JQuery) =>
                        taxTestCallback(dialogHtml, stat, sheet, tax, spellName)
                }
            }
        }).render(true)
    );
}

async function taxTestCallback(
        dialogHtml: JQuery,
        stat: Ability,
        sheet: BWActorSheet,
        tax: number,
        spellName: string) {
    const baseData = extractBaseData(dialogHtml, sheet);
    const exp = parseInt(stat.exp, 10);

    const dieSources = buildDiceSourceObject(exp, baseData.aDice, baseData.bDice, 0, baseData.woundDice, tax);
    const dg = helpers.difficultyGroup(exp + baseData.bDice - (tax || 0) - baseData.woundDice + baseData.miscDice.sum,
        baseData.obstacleTotal);

    const roll = await rollDice(
        exp + baseData.bDice + baseData.aDice - baseData.woundDice - (tax || 0) + baseData.miscDice.sum,
        stat.open,
        stat.shade);
    if (!roll) { return; }
    const isSuccessful = parseInt(roll.result, 10) >= baseData.obstacleTotal;

    const fateReroll = buildRerollData(sheet.actor, roll, "data.forte");
    const callons: RerollData[] = sheet.actor.getCallons(name).map(s => {
        return { label: s, ...buildRerollData(sheet.actor, roll, "data.forte") as RerollData };
    });

    const data: RollChatMessageData = {
        name: `${spellName} Tax`,
        successes: roll.result,
        difficulty: baseData.diff + baseData.obPenalty,
        obstacleTotal: baseData.obstacleTotal,
        nameClass: getRollNameClass(stat.open, stat.shade),
        success: isSuccessful,
        rolls: roll.dice[0].rolls,
        difficultyGroup: dg,
        penaltySources: baseData.penaltySources,
        dieSources: { ...dieSources, ...baseData.miscDice.entries },
        fateReroll,
        callons
    };
    data.extraInfo = `Attempting to sustain ${spellName}.`;
    sheet.actor.addStatTest(stat, "Forte", "data.forte", dg, isSuccessful);

    if (!isSuccessful) {
        const margin = baseData.obstacleTotal - parseInt(roll.result);
        const forteExp = parseInt(stat.exp);
        if (forteExp < margin + tax ) {
            // overtax.
            const baseWound = (margin + tax - forteExp) * baseData.obstacleTotal;
            data.extraInfo += ` Tax test failed by ${margin}. The caster maxes out their Forte tax and risks a B${baseWound} wound.`;
            new Dialog({
                title: "Overtaxed!",
                content: `<p>Failing your tax test by ${margin} when you have ${forteExp - tax} untaxed Forte dice has resulted in overtax.</p>
                <p>Your forte will be maxed out automatically as your character falls unconscious. Also apply a B${baseWound} wound to your character.</p>`,
                buttons: {
                    yes: {
                        label: "Ouch! Okay.",
                        callback: () => {
                            sheet.actor.update({ data: { forteTax: forteExp }});
                        }
                    },
                    no: {
                        label: "I'd rather not.",
                        callback: () => { return; }
                    }
                }
            }).render(true);
        } else {
            data.extraInfo += ` Tax test failed by ${margin}. The caster's forte is Taxed.`;
            new Dialog({
                title: "Taxed",
                content: `<p>You failed your tax test! Your forte tax will increase by ${margin}.</p>
                <p>Also, any currently sustained spells are lost.</p>`,
                buttons: {
                    yes: {
                        label: "Ok",
                        callback: () => {
                            sheet.actor.update({ data: { forteTax: tax + margin }});
                        }
                    },
                    no: {
                        label: "Skip for Now",
                        callback: () => { return; }
                    }
                }
            }).render(true);
        }

    }

    const messageHtml = await renderTemplate(templates.skillMessage, data);
    return ChatMessage.create({
        content: messageHtml,
        speaker: ChatMessage.getSpeaker({actor: sheet.actor})
    });
}

interface StatDialogData extends RollDialogData {
    tax?: number;
    stat: TracksTests;
}