import { expect } from 'playwright/test';
import { testAsGm as test } from '../fixtures/bwFixture';

test('can be created, opens sheet', async ({ gamePage, items }) => {
    await gamePage.createItem('Test Instinct', 'instinct');
    await items.instinct.expectOpened('Test Instinct');
});

test('can load sheet data', async ({ items: { instinct } }) => {
    const sheet = await instinct.openDialog('Modified Instinct');
    await expect(sheet.fateSpent).toHaveValue('1');
    await expect(sheet.personaSpent).toHaveValue('2');
    await expect(sheet.deedsSpent).toHaveValue('3');
    await expect(sheet.description).toHaveValue('A modified text description');
});

test('can be edited', async ({ items: { instinct } }) => {
    const sheet = await instinct.openDialog('Modified Instinct');
    await test.step('edit sheet fields', async () => {
        await sheet.setFateSpent('4');
        await sheet.setPersonaSpent('5');
        await sheet.setDeedsSpent('6');
        await sheet.description.fill('a new description');
        await sheet.close();
    });

    await test.step('reopen sheet and check changes', async () => {
        await sheet.open();
        await expect(sheet.fateSpent).toHaveValue('4');
        await expect(sheet.personaSpent).toHaveValue('5');
        await expect(sheet.deedsSpent).toHaveValue('6');
        await expect(sheet.description).toHaveValue('a new description');
    });
});
