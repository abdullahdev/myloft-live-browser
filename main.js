const puppeteer = require('puppeteer');
const axios = require('axios');
const baseUrl = 'https://live.myloft.ro';
async function startWatcher() {
    const url = process.argv[2];
    try {
        const res = await axios.post(baseUrl +'/api/events/update', {
            // value: newValue
        });
        console.log('POST success:', res.status);
    } catch (err) {
        console.error('POST failed:', err.message);
    }
    const browser = await puppeteer.launch({
        headless: true, // change to false for debugging
        defaultViewport: null,
    });

    const page = await browser.newPage();

    console.log(`Navigating to ${url}...`);
    await page.goto(url, { waitUntil: 'networkidle2' });

    // Wait until the "Arrivals" label is in the DOM
    await page.waitForFunction(() => {
        return Array.from(document.querySelectorAll('.TextLeft-Gray-70'))
            .some(el => el.textContent.trim() === 'Arrivals');
    }, { timeout: 60000 });

    // Grab the initial Arrivals value
    const arrivalsValue = await page.evaluate(() => {
        const labels = Array.from(document.querySelectorAll('.TextLeft-Gray-70'));
        const arrivalsLabel = labels.find(el => el.textContent.trim() === 'Arrivals');
        if (!arrivalsLabel) return null;

        const valueEl = arrivalsLabel.nextElementSibling?.classList.contains('ParagraphLeft-Gray-100-Bold')
            ? arrivalsLabel.nextElementSibling
            : null;

        return valueEl ? valueEl.textContent.trim() : null;
    });

    // console.log('✅ Initial Arrivals value:', arrivalsValue);
    // console.log('Attaching observer...');

    // Expose a Node function so page context can call back
    await page.exposeFunction('onArrivalsChanged', async (newValue) => {
        // console.log('Detected change:', newValue);

        try {
            const res = await axios.post(baseUrl +'/api/events/update', {
                value: newValue
            });
            // console.log('POST success:', res.status);
        } catch (err) {
            // console.error('POST failed:', err.message);
        }
    });

    // Inject MutationObserver into the page
    await page.evaluate(() => {
        const labels = Array.from(document.querySelectorAll('.TextLeft-Gray-70'));
        const arrivalsLabel = labels.find(el => el.textContent.trim() === 'Arrivals');
        if (!arrivalsLabel) return;

        const valueEl = arrivalsLabel.nextElementSibling?.classList.contains('ParagraphLeft-Gray-100-Bold')
            ? arrivalsLabel.nextElementSibling
            : null;
        if (!valueEl) return;

        let lastValue = valueEl.textContent.trim();

        const observer = new MutationObserver(() => {
            const newValue = valueEl.textContent.trim();
            if (newValue !== lastValue) {
                lastValue = newValue;
                window.onArrivalsChanged(newValue);
            }
        });

        observer.observe(valueEl, { characterData: true, childList: true, subtree: true });
    });

    // console.log('👀 Watching for Arrivals changes... (press Ctrl+C to stop)');

    setTimeout(async () => {
        // console.log("⏰ Restarting watcher...");
        await browser.close();
        startWatcher(); // restart
    }, 5 * 60 * 1000);
};

startWatcher();
