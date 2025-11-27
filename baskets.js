const puppeteer = require('puppeteer');

// Helper function to delay execution
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function startWatcher() {
    const url = process.argv[2];
    const browser = await puppeteer.launch({
        headless: true,
        defaultViewport: null,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();

    console.log(`Navigating to ${url}...`);
    await page.goto(url, { waitUntil: 'networkidle2' });

    // Wait 5 seconds after initial page load
    console.log('Waiting 5 seconds after page load...');
    await delay(5000);

    // Wait for the table tbody to appear in the DOM
    await page.waitForFunction(() => {
        const tbody = document.querySelector('tbody');
        return tbody && tbody.querySelectorAll('tr').length > 0;
    }, { timeout: 60000 });

    console.log('✅ Table loaded, clicking "Basket Time" header...');

    // Find and click the TH with <span>Basket Time</span>
    await page.evaluate(() => {
        const thElements = Array.from(document.querySelectorAll('th'));
        const basketTimeTh = thElements.find(th => {
            const span = th.querySelector('span');
            return span && span.textContent.trim() === 'Basket Time';
        });
        
        if (basketTimeTh) {
            basketTimeTh.click();
            console.log('Clicked "Basket Time" header');
        } else {
            console.warn('Could not find "Basket Time" header');
        }
    });

    // Wait 5 seconds after clicking
    console.log('Waiting 5 seconds...');
    await delay(5000);

    console.log('✅ Setting up watcher...');

    // Expose a Node function so page context can call back
    await page.exposeFunction('onTableChanged', async () => {
        console.log('new basket event');
    });

    // Inject MutationObserver into the page to watch for table changes
    await page.evaluate(() => {
        const tbody = document.querySelector('tbody');
        if (!tbody) {
            console.error('No tbody found');
            return;
        }

        // Get initial table content hash
        let lastTableContent = tbody.innerHTML;

        const observer = new MutationObserver(() => {
            const currentTableContent = tbody.innerHTML;
            if (currentTableContent !== lastTableContent) {
                lastTableContent = currentTableContent;
                window.onTableChanged();
            }
        });

        // Observe the tbody for any changes (child additions, removals, attribute changes, etc.)
        observer.observe(tbody, { 
            childList: true, 
            subtree: true, 
            characterData: true,
            attributes: true
        });
    });

    console.log('👀 Watching for table changes... (press Ctrl+C to stop)');
};

startWatcher();
