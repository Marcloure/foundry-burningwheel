import { BWActor, CharacterData, TracksTests } from "./actor.js";
import { BWActorSheet } from "./bwactor-sheet.js";
import * as helpers from "./helpers.js";
import { Relationship, Skill, SkillDataRoot } from "./items/item.js";

export async function handleRollable(
    e: JQuery.ClickEvent<HTMLElement, null, HTMLElement, HTMLElement>, sheet: BWActorSheet): Promise<unknown> {
    const target = e.currentTarget as HTMLButtonElement;
    const rollType = target.dataset.rollType;

    switch(rollType) {
        case "skill":
            return handleSkillRoll(target, sheet);
        case "stat":
            return handleStatRoll(target, sheet);
        case "circles":
            return handleCirclesRoll(target, sheet);
        case "attribute": case "resources":
            return handleAttrRoll(target, sheet);
        case "learning":
            return handleLearningRoll(target, sheet);
    }
}

async function handleAttrRoll(target: HTMLButtonElement, sheet: BWActorSheet): Promise<unknown> {
    const stat = getProperty(sheet.actor.data, target.dataset.accessor || "") as TracksTests;
    const actor = sheet.actor as BWActor;
    const attrName = target.dataset.rollableName || "Unknown Attribute";
    const data: AttributeDialogData = {
        name: `${attrName}`,
        difficulty: 3,
        bonusDice: 0,
        arthaDice: 0,
        woundDice: actor.data.data.ptgs.woundDice,
        obPenalty: actor.data.data.ptgs.obPenalty,
        stat
    };

    const html = await renderTemplate(templates.attrDialog, data);
    return new Promise(_resolve =>
        new Dialog({
            title: `${target.dataset.rollableName} Test`,
            content: html,
            buttons: {
                roll: {
                    label: "Roll",
                    callback: async (dialogHtml: JQuery<HTMLElement>) =>
                        attrRollCallback(dialogHtml, stat, sheet, 0, attrName, target.dataset.accessor || "")
                }
            }
        }).render(true)
    );
}

async function attrRollCallback(
        dialogHtml: JQuery<HTMLElement>,
        stat: TracksTests,
        sheet: BWActorSheet,
        tax: number,
        name: string,
        accessor: string) { // todo add relationship forks here
    const baseData = extractBaseData(dialogHtml, sheet);
    const exp = parseInt(stat.exp, 10);
    const roll = new Roll(`${exp + baseData.bDice + baseData.aDice - baseData.woundDice - tax}d6cs>3`).roll();
    const dieSources = buildDiceSourceObject(exp, baseData.aDice, baseData.bDice, 0, baseData.woundDice, tax);
    const dg = helpers.difficultyGroup(exp + baseData.bDice - tax - baseData.woundDice, baseData.diff);
    const isSuccessful = parseInt(roll.result, 10) >= (baseData.diff + baseData.obPenalty);

    const data: RollChatMessageData = {
        name: `${name} Test`,
        successes: roll.result,
        difficulty: baseData.diff,
        obstacleTotal: baseData.obstacleTotal,
        success: isSuccessful,
        rolls: roll.dice[0].rolls,
        difficultyGroup: dg,
        penaltySources: baseData.penaltySources,
        dieSources
    };

    sheet.actor.addAttributeTest(stat, name, accessor, dg, isSuccessful);
    const messageHtml = await renderTemplate(templates.attrMessage, data);
    return ChatMessage.create({
        content: messageHtml,
        speaker: ChatMessage.getSpeaker({actor: sheet.actor})
    });
}

async function handleCirclesRoll(target: HTMLButtonElement, sheet: BWActorSheet): Promise<unknown> {
    const stat = getProperty(sheet.actor.data, "data.circles") as TracksTests;
    let circlesContact: Relationship | undefined;
    if (target.dataset.relationshipId) {
        circlesContact = sheet.actor.getOwnedItem(target.dataset.relationshipId) as Relationship;
    }
    const actor = sheet.actor as BWActor;
    const data: CirclesDialogData = {
        name: target.dataset.rollableName || "Circles Test",
        difficulty: 3,
        bonusDice: 0,
        arthaDice: 0,
        woundDice: actor.data.data.ptgs.woundDice,
        obPenalty: actor.data.data.ptgs.obPenalty,
        stat,
        circlesBonus: actor.data.circlesBonus,
        circlesMalus: actor.data.circlesMalus,
        circlesContact
    };

    const html = await renderTemplate(templates.circlesDialog, data);
    return new Promise(_resolve =>
        new Dialog({
            title: `Circles Test`,
            content: html,
            buttons: {
                roll: {
                    label: "Roll",
                    callback: async (dialogHtml: JQuery<HTMLElement>) =>
                        circlesRollCallback(dialogHtml, stat, sheet, circlesContact)
                }
            }
        }).render(true)
    );
}

async function circlesRollCallback(
        dialogHtml: JQuery<HTMLElement>,
        stat: TracksTests,
        sheet: BWActorSheet,
        contact?: Relationship) {
    const baseData = extractBaseData(dialogHtml, sheet);
    const bonusData = extractCirclesBonuses(dialogHtml, "circlesBonus");
    const penaltyData = extractCirclesPenalty(dialogHtml, "circlesMalus");
    const exp = parseInt(stat.exp, 10);
    const dieSources = {
        ...buildDiceSourceObject(exp, baseData.aDice, baseData.bDice, 0, baseData.woundDice, 0),
        ...bonusData.bonuses
    };
    const dg = helpers.difficultyGroup(
        exp + baseData.bDice - baseData.woundDice,
        baseData.diff + baseData.obPenalty + penaltyData.sum);

    if (contact) {
        dieSources["Named Contact"] = "+1";
        baseData.bDice ++;
    }
    const roll = new Roll(`${exp + baseData.bDice + baseData.aDice + bonusData.sum - baseData.woundDice}d6cs>3`)
        .roll();
    baseData.obstacleTotal += penaltyData.sum;
    const data: RollChatMessageData = {
        name: `Circles Test`,
        successes: roll.result,
        difficulty: baseData.diff,
        obstacleTotal: baseData.obstacleTotal,
        success: parseInt(roll.result, 10) >= baseData.obstacleTotal,
        rolls: roll.dice[0].rolls,
        difficultyGroup: dg,
        dieSources,
        penaltySources: { ...baseData.penaltySources, ...penaltyData.bonuses }
    };
    const messageHtml = await renderTemplate(templates.circlesMessage, data);

    // incremet relationship tracking values...
    if (contact && contact.data.data.building) {
        contact.update({"data.buildingProgress": parseInt(contact.data.data.buildingProgress, 10) + 1 }, null);
    }

    sheet.actor.addAttributeTest(stat, "Circles", "data.circles", dg, true);

    return ChatMessage.create({
        content: messageHtml,
        speaker: ChatMessage.getSpeaker({actor: sheet.actor})
    });
}

async function handleLearningRoll(target: HTMLButtonElement, sheet: BWActorSheet): Promise<unknown> {
    const skillId = target.dataset.skillId || "";
    const skill = (sheet.actor.getOwnedItem(skillId) as Skill);
    const actor = sheet.actor as BWActor;
    const data: LearningDialogData = {
        name: `Beginner's Luck ${target.dataset.rollableName} Test`,
        difficulty: 3,
        bonusDice: 0,
        arthaDice: 0,
        woundDice: actor.data.data.ptgs.woundDice,
        obPenalty: actor.data.data.ptgs.obPenalty,
        skill: { exp: 10 - (skill.data.data.aptitude || 1) } as any
    };

    const html = await renderTemplate(templates.learnDialog, data);
    return new Promise(_resolve =>
        new Dialog({
            title: `${target.dataset.rollableName} Test`,
            content: html,
            buttons: {
                roll: {
                    label: "Roll",
                    callback: async (dialogHtml: JQuery<HTMLElement>) =>
                        learningRollCallback(dialogHtml, skill, sheet)
                }
            }
        }).render(true)
    );
}

async function learningRollCallback(
    dialogHtml: JQuery<HTMLElement>, skill: Skill, sheet: BWActorSheet): Promise<unknown> {

    const baseData = extractBaseData(dialogHtml, sheet);
    baseData.obstacleTotal += baseData.diff;
    baseData.penaltySources["Beginner's Luck"] = `+${baseData.diff}`;
    const exp = 10 - (skill.data.data.aptitude || 1);
    const roll = new Roll(`${exp + baseData.bDice + baseData.aDice - baseData.woundDice}d6cs>3`).roll();
    const dieSources = buildDiceSourceObject(exp, baseData.aDice, baseData.bDice, 0, baseData.woundDice, 0);
    const dg = helpers.difficultyGroup(exp + baseData.bDice- baseData.woundDice, baseData.diff);
    const isSuccessful = parseInt(roll.result, 10) >= baseData.obstacleTotal;
    const data: RollChatMessageData = {
        name: `Beginner's Luck ${skill.data.name} Test`,
        successes: roll.result,
        difficulty: baseData.diff,
        obstacleTotal: baseData.obstacleTotal,
        success: isSuccessful,
        rolls: roll.dice[0].rolls,
        difficultyGroup: dg,
        penaltySources: baseData.penaltySources,
        dieSources,
    };
    const messageHtml = await renderTemplate(templates.learnMessage, data);
    advanceLearning(skill, sheet.actor, dg, isSuccessful);
    return ChatMessage.create({
        content: messageHtml,
        speaker: ChatMessage.getSpeaker({actor: sheet.actor})
    });
}


async function handleStatRoll(target: HTMLButtonElement, sheet: BWActorSheet): Promise<unknown> {
    const stat = getProperty(sheet.actor.data, target.dataset.accessor || "") as TracksTests;
    const actor = sheet.actor as BWActor;
    const statName = target.dataset.rollableName || "Unknown Stat";
    let tax = 0;
    if (target.dataset.rollableName!.toLowerCase() === "will") {
        tax = parseInt(actor.data.data.willTax, 10);
    }
    const data: StatDialogData = {
        name: `${statName} Test`,
        difficulty: 3,
        bonusDice: 0,
        arthaDice: 0,
        woundDice: actor.data.data.ptgs.woundDice,
        obPenalty: actor.data.data.ptgs.obPenalty,
        stat,
        tax
    };

    const html = await renderTemplate(templates.statDialog, data);
    return new Promise(_resolve =>
        new Dialog({
            title: `${statName} Test`,
            content: html,
            buttons: {
                roll: {
                    label: "Roll",
                    callback: async (dialogHtml: JQuery<HTMLElement>) =>
                        statRollCallback(dialogHtml, stat, sheet, tax, statName, target.dataset.accessor || "")
                }
            }
        }).render(true)
    );
}

async function statRollCallback(
        dialogHtml: JQuery<HTMLElement>,
        stat: TracksTests,
        sheet: BWActorSheet,
        tax: number,
        name: string,
        accessor: string) {
    const baseData = extractBaseData(dialogHtml, sheet);
    const exp = parseInt(stat.exp, 10);
    const roll = new Roll(`${exp + baseData.bDice + baseData.aDice - baseData.woundDice - tax}d6cs>3`).roll();
    const dieSources = buildDiceSourceObject(exp, baseData.aDice, baseData.bDice, 0, baseData.woundDice, tax);
    const isSuccessful = parseInt(roll.result, 10) >= baseData.obstacleTotal;
    const dg = helpers.difficultyGroup(exp + baseData.bDice - tax - baseData.woundDice, baseData.diff);

    const data: RollChatMessageData = {
        name: `${name} Test`,
        successes: roll.result,
        difficulty: baseData.diff + baseData.obPenalty,
        obstacleTotal: baseData.obstacleTotal,
        success: isSuccessful,
        rolls: roll.dice[0].rolls,
        difficultyGroup: dg,
        penaltySources: baseData.penaltySources,
        dieSources,
    };

    sheet.actor.addStatTest(stat, name, accessor, dg, isSuccessful);

    const messageHtml = await renderTemplate(templates.skillMessage, data);
    return ChatMessage.create({
        content: messageHtml,
        speaker: ChatMessage.getSpeaker({actor: sheet.actor})
    });
}

async function handleSkillRoll(target: HTMLButtonElement, sheet: BWActorSheet): Promise<unknown> {
    const skillId = target.dataset.skillId || "";
    const skill = (sheet.actor.getOwnedItem(skillId) as Skill);
    const actor = sheet.actor as BWActor;
    const templateData: SkillDialogData = {
        name: skill.data.name,
        difficulty: 3,
        bonusDice: 0,
        arthaDice: 0,
        woundDice: actor.data.data.ptgs.woundDice,
        obPenalty: actor.data.data.ptgs.obPenalty,
        skill: skill.data.data,
        forkOptions: actor.getForkOptions(skill.data.name)
    };
    const html = await renderTemplate(templates.skillDialog, templateData);
    return new Promise(_resolve =>
        new Dialog({
            title: `${skill.data.name} Test`,
            content: html,
            buttons: {
                roll: {
                    label: "Roll",
                    callback: async (dialogHtml: JQuery<HTMLElement>) =>
                        skillRollCallback(dialogHtml, skill, sheet)
                }
            }
        }).render(true)
    );
}

async function skillRollCallback(
    dialogHtml: JQuery<HTMLElement>, skill: Skill, sheet: BWActorSheet): Promise<unknown> {

    const forks = extractForksValue(dialogHtml, "forkOptions");
    const baseData = extractBaseData(dialogHtml, sheet);
    const exp = parseInt(skill.data.data.exp, 10);
    const roll = new Roll(`${exp + baseData.bDice + baseData.aDice + forks - baseData.woundDice}d6cs>3`).roll();
    const dieSources = buildDiceSourceObject(exp, baseData.aDice, baseData.bDice, forks, baseData.woundDice, 0);
    const dg = helpers.difficultyGroup(exp + baseData.bDice + forks - baseData.woundDice, baseData.diff);
    const data: RollChatMessageData = {
        name: `${skill.name} Test`,
        successes: roll.result,
        difficulty: baseData.diff,
        obstacleTotal: baseData.obstacleTotal,
        success: parseInt(roll.result, 10) >= baseData.obstacleTotal,
        rolls: roll.dice[0].rolls,
        difficultyGroup: dg,
        penaltySources: baseData.penaltySources,
        dieSources,
    };

    await helpers.addTestToSkill(skill, dg);
    skill = sheet.actor.getOwnedItem(skill._id) as Skill; // update skill with new data
    if (helpers.canAdvance(skill.data.data)) {
        Dialog.confirm({
            title: `Advance ${skill.name}?`,
            content: `<p>${skill.name} is ready to advance. Go ahead?</p>`,
            yes: () => helpers.advanceSkill(skill),
            // tslint:disable-next-line: no-empty
            no: () => {},
            defaultYes: true
        });
    }

    const messageHtml = await renderTemplate(templates.skillMessage, data);
    return ChatMessage.create({
        content: messageHtml,
        speaker: ChatMessage.getSpeaker({actor: sheet.actor})
    });
}

function buildDiceSourceObject(
        exp: number,
        aDice: number,
        bDice: number,
        forks: number,
        woundDice: number,
        tax: number) {
    const dieSources: { [i: string]: string } = {
        "Exponent": `+${exp}`,
    };
    if (aDice) { dieSources.Artha = `+${aDice}`; }
    if (bDice) { dieSources.Bonus = `+${bDice}`; }
    if (forks) { dieSources.FoRKs = `+${forks}`; }
    if (woundDice) { dieSources["Wound Penalty"] = `-${woundDice}`; }
    if (tax) { dieSources.Tax = `-${tax}`; }
    return dieSources;
}

/* ======== Helper functions ======================= */
function extractBaseData(html: JQuery<HTMLElement>, sheet: BWActorSheet ) {
    const actorData = sheet.actor.data as CharacterData;
    const woundDice = actorData.data.ptgs.woundDice || 0;
    const obPenalty = actorData.data.ptgs.obPenalty || 0;
    const penaltySources: { [i:string]: string} = obPenalty ? { "Wound Penalty": `+${obPenalty}` } : { };
    const diff = extractNumber(html, "difficulty");
    const aDice = extractNumber(html, "arthaDice");
    const bDice = extractNumber(html, "bonusDice");
    const obstacleTotal = diff + obPenalty;

    return { woundDice, obPenalty, diff, aDice, bDice, penaltySources, obstacleTotal };
}

function extractString(html: JQuery<HTMLElement>, name: string): string {
    return html.find(`input[name=\"${name}\"]`).val() as string;
}

function extractNumber(html: JQuery<HTMLElement>, name: string): number {
    return parseInt(extractString(html, name), 10);
}

function extractForksValue(html: JQuery<HTMLElement>, name: string): number {
    let sum: number = 0;
    html.find(`input[name=\"${name}\"]:checked`).each((_i, v) => {
        sum += parseInt(v.getAttribute("value") || "", 10);
    });
    return sum;
}

function extractCirclesBonuses(html: JQuery<HTMLElement>, name: string):
        { bonuses: {[name: string]: string }, sum: number} {
    const bonuses:{[name: string]: string } = {};
    let sum = 0;
    html.find(`input[name=\"${name}\"]:checked`).each((_i, v) => {
        sum += parseInt(v.getAttribute("value") || "", 10);
        bonuses[v.dataset.name || ""] = "+" + v.getAttribute("value");
    });
    return { bonuses, sum };
}

function extractCirclesPenalty(html: JQuery<HTMLElement>, name: string):
        { bonuses: {[name: string]: string }, sum: number} {
    return extractCirclesBonuses(html, name);
}

async function advanceLearning(
        skill: Skill,
        owner: BWActor,
        difficultyGroup: helpers.TestString,
        isSuccessful: boolean) {
    switch (difficultyGroup) {
        default:
            return advanceBaseStat(skill, owner, difficultyGroup, isSuccessful);
        case "Routine":
            return advanceLearningProgress(skill);
        case "Routine/Difficult":
            // we can either apply this to the base stat or to the learning
            const dialog = new Dialog({
                title: "Pick where to assing the test",
                content: "<p>This test can count as routine of difficult for the purposes of advancement</p><p>Pick which option you'd prefer.</p>",
                buttons: {
                    skill: {
                        label: "Apply as Routine",
                        callback: async () => advanceLearningProgress(skill)
                    },
                    stat: {
                        label: "Apply as Difficult",
                        callback: async () => advanceBaseStat(skill, owner, "Difficult", isSuccessful)
                    }
                }
            });
            return dialog.render(true);
    }
}

async function advanceBaseStat(
        skill: Skill,
        owner: BWActor,
        difficultyGroup: helpers.TestString,
        isSuccessful: boolean) {
    if (!skill.data.data.root2) {
        // we can immediately apply the test to the one root stat.
        const rootName = skill.data.data.root1;
        const accessor = `data.${rootName.toLowerCase()}`;
        const rootStat = getProperty(owner, `data.${accessor}`);
        await owner.addStatTest(rootStat, rootName, accessor, difficultyGroup, isSuccessful);
        return skill.update({}, {}); // force refresh in case the base stat changes.
    }

    // otherwise we have 2 roots and we let the player pick one.
    const choice = new Dialog({
        title: "Pick root stat to advance",
        content: `<p>This test can count towards advancing ${skill.data.data.root1} or ${skill.data.data.root2}</p><p>Which one to advance?</p>`,
        buttons: {
            stat1: {
                label: skill.data.data.root1,
                callback: async () => {
                    const rootName = skill.data.data.root1.titleCase();
                    const accessor = `data.${rootName.toLowerCase()}`;
                    const rootStat = getProperty(owner, `data.${accessor}`);
                    await owner.addStatTest(
                        rootStat, rootName, `${accessor}`, difficultyGroup, isSuccessful);
                    return skill.update({}, {}); // force refresh in case the base stat changes.
                }
            },
            stat2: {
                label: skill.data.data.root2,
                callback: async () => {
                    const rootName = skill.data.data.root2.titleCase();
                    const accessor = `data.${rootName.toLowerCase()}`;
                    const rootStat = getProperty(owner, `data.${accessor}`);
                    await owner.addStatTest(
                        rootStat, rootName, `${accessor}`, difficultyGroup, isSuccessful);
                    return skill.update({}, {}); // force refresh in case the base stat changes.
                }
            }
        }
    });
    return choice.render(true);
}

async function advanceLearningProgress(skill: Skill) {
    const progress = parseInt(skill.data.data.learningProgress, 10);
    const requiredTests = skill.data.data.aptitude || 10;

    skill.update({"data.learningProgress": progress + 1 }, {});
    if (progress + 1 >= requiredTests) {
        Dialog.confirm({
            title: `Finish Training ${skill.name}?`,
            content: `<p>${skill.name} is ready to become a full skill. Go ahead?</p>`,
            yes: () => {
                const updateData = {};
                updateData["data.learning"] = false;
                updateData["data.exp"] = Math.floor((10 - requiredTests) / 2);
                skill.update(updateData, {});
            },
            // tslint:disable-next-line: no-empty
            no: () => {},
            defaultYes: true
        });
    }
}

/* ============ Constants =============== */
const templates = {
    attrDialog: "systems/burningwheel/templates/chat/roll-dialog.html",
    attrMessage: "systems/burningwheel/templates/chat/roll-message.html",
    circlesDialog: "systems/burningwheel/templates/chat/circles-dialog.html",
    circlesMessage: "systems/burningwheel/templates/chat/roll-message.html",
    learnDialog: "systems/burningwheel/templates/chat/roll-dialog.html",
    learnMessage: "systems/burningwheel/templates/chat/roll-message.html",
    skillDialog: "systems/burningwheel/templates/chat/skill-dialog.html",
    skillMessage: "systems/burningwheel/templates/chat/roll-message.html",
    statDialog: "systems/burningwheel/templates/chat/roll-dialog.html",
    statMessage: "systems/burningwheel/templates/chat/roll-message.html"
};


/* =============== Types ================= */
export interface LearningDialogData extends RollDialogData {
    skill: SkillDataRoot;
}

export interface CirclesDialogData extends AttributeDialogData {
    circlesBonus?: {name: string, amount: number}[];
    circlesMalus?: {name: string, amount: number}[];
    circlesContact?: Item;
}

export interface AttributeDialogData extends RollDialogData {
    stat: TracksTests;
    tax?: number;
}

export interface StatDialogData extends RollDialogData {
    tax?: number;
    stat: TracksTests;
}

export interface SkillDialogData extends RollDialogData {
    skill: TracksTests;
    forkOptions: Item[];
}

interface RollDialogData {
    name: string;
    difficulty: number;
    arthaDice: number;
    bonusDice: number;
    woundDice?: number;
    obPenalty?: number;
}

export interface RollChatMessageData {
    name: string;
    successes: string;
    difficulty: number;
    specialPenalty?: { name: string, amount: number };
    success: boolean;
    rolls: {success: boolean, roll: number}[];
    difficultyGroup: string;
    obstacleTotal: number;

    dieSources?: { [i: string]: string };
    penaltySources?: { [i: string]: string };
}