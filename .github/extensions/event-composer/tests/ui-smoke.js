export default async function uiSmoke(page) {
    const assert = (ok, message) => { if (!ok) throw new Error(message); };
    const reset = () => page.evaluate(async () => {
        const response = await fetch('/api/reset', { method: 'POST', headers: {
            'x-composer-token': new URL(location.href).searchParams.get('t'),
            'content-type': 'application/json',
        }, body: '{}' });
        if (!response.ok) throw new Error(`Reset failed: ${response.status}`);
    });
    const saved = () => page.waitForTimeout(750);
    const input = path => page.locator(`[data-path="${path}"]`);
    await reset();
    await page.reload();
    try {
        await page.getByRole('button', { name: 'Add talk', exact: true }).click();
        let picker = page.getByRole('combobox', { name: 'Add a speaker' });
        await picker.fill('Jane Smoke');
        await picker.press('Enter');
        assert(await input('talks.0.speakers.0.firstname').inputValue() === 'Jane', 'New name prefill');
        assert(await input('talks.0.speakers.0.lastname').inputValue() === 'Smoke', 'New surname prefill');
        await page.getByRole('button', { name: 'Add social profile', exact: true }).click();
        await page.getByRole('textbox', { name: 'Social link 1', exact: true }).fill('https://github.com/jane-smoke');
        await saved();
        await page.getByRole('button', { name: 'Remove social profile 1', exact: true }).click();
        await saved();
        await page.getByRole('button', { name: 'Undo', exact: true }).click();
        assert(await page.getByRole('textbox', { name: 'Social link 1', exact: true }).inputValue() === 'https://github.com/jane-smoke', 'Undo after normalized save');
        await page.locator('.image-field').first().evaluate(zone => {
            const data = new DataTransfer();
            data.items.add(new File(['<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#1678b7"/></svg>'], 'smoke.svg', { type: 'image/svg+xml' }));
            zone.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: data }));
        });
        await page.locator('.upload-chip').waitFor();
        await saved();
        await page.reload();
        await page.locator('.upload-chip').waitFor();
        assert(await page.locator('.image-preview img').count() === 1, 'Persistent upload preview');
        await page.getByRole('button', { name: 'Clear photo', exact: true }).click();
        assert(await page.locator('.upload-chip').count() === 0, 'Clear upload');
        await page.getByRole('button', { name: 'Add partner', exact: true }).click();
        const known = await page.evaluate(async () => {
            const state = await (await fetch('/api/state', { headers: { 'x-composer-token': new URL(location.href).searchParams.get('t') } })).json();
            return state.catalog.companies.filter(c => c.link && c.logo).slice(0, 2);
        });
        assert(known.length === 2, 'Fixture needs two linked catalog companies with logos');
        await input('partners.0.name').fill(known[0].name);
        await saved();
        assert(await input('partners.0.link').inputValue() === known[0].link, 'Partner autofill');
        assert(await input('partners.0.logo').inputValue() === known[0].logo, 'Partner logo autofill');
        await input('partners.0.name').fill('');
        await input('partners.0.name').pressSequentially(known[1].name);
        await saved();
        assert(await input('partners.0.link').inputValue() === known[1].link, 'Replace catalog link while typing a new company');
        assert(await input('partners.0.logo').inputValue() === known[1].logo, 'Replace catalog logo while typing a new company');
        let previewSrc = await page.locator('.partner .image-preview img').getAttribute('src');
        assert(new URL(previewSrc, page.url()).pathname.endsWith(`/repo${known[1].logo}`), 'Refresh company logo preview after autofill');
        await input('partners.0.link').fill('https://example.com/custom');
        await saved();
        await input('partners.0.name').fill(known[0].name);
        await saved();
        assert(await input('partners.0.link').inputValue() === 'https://example.com/custom', 'Preserve custom partner link');
        await page.getByRole('button', { name: 'Add partner', exact: true }).click();
        await page.locator('.partner').nth(1).locator('.image-field').evaluate(zone => {
            const data = new DataTransfer();
            data.items.add(new File(['<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#1678b7"/></svg>'], 'partner-smoke.svg', { type: 'image/svg+xml' }));
            zone.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: data }));
        });
        const stagedPreview = page.locator('.partner').nth(1).locator('.image-preview img');
        await stagedPreview.waitFor();
        const stagedSrc = await stagedPreview.getAttribute('src');
        await input('partners.1.name').fill(known[0].name);
        await saved();
        assert(await page.locator('.partner').nth(1).locator('.upload-chip').count() === 1, 'Preserve staged company logo');
        assert(await stagedPreview.getAttribute('src') === stagedSrc, 'Preserve staged company logo preview');
        await page.getByRole('button', { name: 'Add talk', exact: true }).click();
        picker = page.getByRole('combobox', { name: 'Add a speaker' }).last();
        await picker.fill('Thomas');
        await picker.press('Enter');
        await saved();
        assert(await page.locator('[data-speaker-status]').filter({ hasText: 'Existing profile' }).count() === 1, 'Existing speaker status');
        await page.getByRole('button', { name: 'Move talk 2 up', exact: true }).click();
        await saved();
        assert(await page.evaluate(() => document.activeElement.dataset.path) === 'talks.0.title', 'Reorder focus');
        await page.getByRole('button', { name: 'Remove talk 2', exact: true }).click();
        await saved();
        await input('event.name').fill('Edited while undo was pending');
        await saved();
        await page.getByRole('button', { name: 'Undo', exact: true }).click();
        await saved();
        assert(await page.getByRole('combobox', { name: 'Add a speaker' }).count() === 1, 'Reject undo after a later local edit');
        assert(await input('event.name').inputValue() === 'Edited while undo was pending', 'Keep later local edit when undo is rejected');
        await page.getByRole('button', { name: 'Go to', exact: true }).first().click();
        assert(await page.evaluate(() => document.activeElement.tabIndex) >= 0, 'Review navigation preserves tab stop');
        await page.locator('summary').filter({ hasText: 'content/meetups/events.yml' }).click();
        assert(await page.locator('.d.add').count() > 0, 'Updated YAML diff');
        for (const width of [1280, 390]) {
            await page.setViewportSize({ width, height: 844 });
            assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Overflow at ${width}px`);
        }
    } finally {
        await reset();
        await page.reload();
    }
}
