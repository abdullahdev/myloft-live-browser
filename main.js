const puppeteer = require('puppeteer');
const axios = require('axios');
const fs = require('fs');
// const baseUrl = 'https://live-api.myloft.ro';
const baseUrl = 'http://127.0.0.1:8000';
let postData = {};
async function startWatcher() {
    const url = process.argv[2];
    const browser = await puppeteer.launch({
        headless: false, // change to false for debugging
        defaultViewport: null,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();

    console.log(`Navigating to ${url}...`);
    await page.goto(url, { waitUntil: 'networkidle2' });

    // Wait until the "Arrivals" label is in the DOM
    await page.waitForFunction(() => {
        return Array.from(document.querySelectorAll('.TextLeft-Gray-70'))
            .some(el => el.textContent.trim() === 'Arrivals');
    }, { timeout: 60000 });

    // Extract date/time, distance, location, and title
    const { dateTime, distance, location, title } = await page.evaluate(() => {
        // Find all list items with icons
        const listItems = Array.from(document.querySelectorAll('.v-list-item'));
        
        let dateTime = null;
        let distance = null;
        let location = null;

        listItems.forEach(item => {
            const icon = item.querySelector('.fas');
            if (!icon) return;

            const subtitle = item.querySelector('.v-list-item__subtitle.TextLeft-Gray-85');
            if (!subtitle) return;

            const text = subtitle.textContent.trim();

            // Check icon classes to identify what data this is
            if (icon.classList.contains('fa-calendar')) {
                dateTime = text;
            } else if (icon.classList.contains('fa-route')) {
                distance = text;
                console.log('   Distance:', distance);
            } else if (icon.classList.contains('fa-map-marked')) {
                location = text;
            }
        });

        // Extract title from Heading-3Left-Gray-100
        let title = null;
        const titleElement = document.querySelector('.Heading-3Left-Gray-100');
        if (titleElement) {
            title = titleElement.textContent.trim();
        }

        return { dateTime, distance, location, title };
    });
    // if(distance){
    //     const distanceKm = distance ? parseInt(distance.match(/\d+/)?.[0] || '0', 10) : null;
    // }
    let distanceKm = 0;
    let isMiles = false;
    let distanceInMiles = 0;
    if(distance){
        if(!distance.includes('km')){
            //it must be miles so convert to km
            distanceInMiles = distance ? parseInt(distance.match(/\d+/)?.[0] || '0', 10) : null;
            isMiles = true;
        }
        distanceKm = distance ? parseInt(distance.match(/\d+/)?.[0] || '0', 10) : null;
    }

    // Convert dateTime to UTC ISO format
    // Format: "13.11.2025 09:10:00 (GMT -6:00)" -> UTC ISO string
    let dateTimeUtc = null;
    if (dateTime) {
        try {
            // Parse the date/time string - try multiple regex patterns to handle variations
            // Pattern 1: "13.11.2025 09:10:00 (GMT -6:00)" or "13.11.2025 09:10:00 (GMT -6)"
            let match = dateTime.match(/(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2}):(\d{2})\s+\(GMT\s*([+-])(\d{1,2})(?::(\d{2}))?\)/);
            
            if (!match) {
                // Pattern 2: Try without colon in timezone offset "GMT -6" or "GMT-6"
                match = dateTime.match(/(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2}):(\d{2})\s+\(GMT\s*([+-])(\d{1,2})\)/);
            }
            
            if (match) {
                const [, day, month, year, hour, minute, second, tzSign, tzHour, tzMinute] = match;
                const tzOffsetHour = parseInt(tzHour) || 0;
                const tzOffsetMin = parseInt(tzMinute) || 0;
                
                // Create a UTC date object for the parsed date/time
                const utcDate = new Date(Date.UTC(
                    parseInt(year),
                    parseInt(month) - 1, // Month is 0-indexed
                    parseInt(day),
                    parseInt(hour),
                    parseInt(minute),
                    parseInt(second)
                ));
                
                // Apply timezone offset: if GMT-6:00, we need to add 6 hours to get UTC
                // If GMT+6:00, we subtract 6 hours to get UTC
                const tzOffsetMinutes = (tzSign === '+' ? -1 : 1) * (tzOffsetHour * 60 + tzOffsetMin);
                const adjustedDate = new Date(utcDate.getTime() + tzOffsetMinutes * 60 * 1000);
                
                // Format as "DD.MM.YYYY HH:mm:ss UTC" (matching original format style)
                const utcDay = String(adjustedDate.getUTCDate()).padStart(2, '0');
                const utcMonth = String(adjustedDate.getUTCMonth() + 1).padStart(2, '0');
                const utcYear = adjustedDate.getUTCFullYear();
                const utcHour = String(adjustedDate.getUTCHours()).padStart(2, '0');
                const utcMin = String(adjustedDate.getUTCMinutes()).padStart(2, '0');
                const utcSec = String(adjustedDate.getUTCSeconds()).padStart(2, '0');
                dateTimeUtc = `${utcDay}.${utcMonth}.${utcYear} ${utcHour}:${utcMin}:${utcSec}`;
            } else {
                console.error('Failed to parse dateTime format:', dateTime);
            }
        } catch (err) {
            console.error('Error converting dateTime to UTC:', err.message);
            console.error('dateTime value:', dateTime);
        }
    }

    // console.log('✅ Extracted data:');
    // console.log('   Title:', title);
    // console.log('   Date/Time (original):', dateTime);
    // console.log('   Date/Time (UTC):', dateTimeUtc);
    // console.log('   Distance:', distanceKm);
    // console.log('   Location:',  (location) ? location : '-');
    // console.log('   URL:', url);
    // console.log('   Total Birds:', totalBirds);

   

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

    //split the text using / and get the second part
    let totalBirds;
    let arrivedBirds;
    if(!arrivalsValue.includes('/')){
        totalBirds = '0';
        arrivedBirds = '0';
        arrivedBirds = arrivalsValue;
    }else{
        totalBirds = arrivalsValue.split('/')[1];    
        arrivedBirds = arrivalsValue.split('/')[0];
    }
     
     postData = {
        url: url,
        title: title,
        dateTime: dateTimeUtc,
        display_start_time: dateTime,
        distance: distanceKm.toString(),
        distance_in_miles: distanceInMiles.toString(),
        location: (location) ? location : '-',
        totalBirds: totalBirds,
        arrivedBirds: arrivedBirds,
        is_miles: isMiles
     }
    console.log('postData', postData);
     try {
        const res = await axios.post(baseUrl + '/api/events/update', postData);
        console.log('✅ Initial POST success:', res.status);
    } catch (err) {
        console.log('error', err.body);
        console.error('❌ Initial POST failed:', err.message);
    }

    // Expose a Node function so page context can send full pigeons arrays
    await page.exposeFunction('onPigeonsBatchUpdated', async (pigeons) => {
        try {
            // TEST ONLY: save latest pigeons batch to a file before posting
            // Comment this block out in production.
            fs.writeFileSync(
                'pigeons-debug.json',
                JSON.stringify(pigeons, null, 2),
                'utf8'
            );
        } catch (err) {
            console.error('Failed to write pigeons-debug.json:', err.message);
        }

        try {
            if (Array.isArray(pigeons) && pigeons.length > 0) {
                const orders = pigeons
                    .map(p => p.arrival_order)
                    .filter(n => typeof n === 'number');
                const minOrder = Math.min(...orders);
                const maxOrder = Math.max(...orders);
                console.log('Pigeons batch size:', pigeons.length, 'arrival_order range:', minOrder, 'to', maxOrder);
            }
            const res = await axios.post(baseUrl + '/api/events/update', {
                url: postData.url,
                pigeons: pigeons
            });
            console.log('✅ Pigeons batch POST success:', res.status, 'count:', Array.isArray(pigeons) ? pigeons.length : 0);
        } catch (err) {
            console.error('❌ Pigeons batch POST failed:', err.message);
        }
    });

    // Switch to the "Arrivals" tab so we can work with the ordered arrivals list
    await page.evaluate(() => {
        const candidates = Array.from(document.querySelectorAll('a[role="tab"], button[role="tab"], .v-tab'));
        const arrivalsTab = candidates.find(el => el.textContent && el.textContent.trim().includes('Arrivals'));
        if (arrivalsTab) {
            (arrivalsTab).click();
        } else {
            console.warn('Arrivals tab not found');
        }
    });

    // Give the Arrivals tab a moment to render its table
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Start a collector in the page that:
    //  - walks through all pages once and builds an array of pigeons
    //  - posts the full array when done
    //  - then watches for new pigeons and new pages every 5 seconds, updating and re-posting as needed
    await page.evaluate(() => {
        const win = window;
        if (win.__pigeonCollectorStarted) {
            return;
        }
        win.__pigeonCollectorStarted = true;

        const state = {
            pigeons: [],
            initialScanDone: false
        };

        function parseArrivalTime(raw) {
            if (!raw) return null;
            const text = raw.trim();
            const match = text.match(/(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?)/);
            if (!match) return null;
            const [, day, month, year, time] = match;
            // Convert "DD.MM.YYYY HH:mm:ss.SSS" -> "YYYY-MM-DD HH:mm:ss.SSS"
            return `${year}-${month}-${day} ${time}`;
        }

        function getCountryFromFlag(td) {
            const flagEl = td.querySelector('.flag');
            if (!flagEl) return null;
            const cls = Array.from(flagEl.classList).find(c => c.startsWith('f-') && c.length > 2);
            if (!cls) return null;
            return cls.slice(2).toUpperCase();
        }

        function parsePigeonRow(tr) {
            const cells = tr.querySelectorAll('td');
            if (cells.length < 3) return null;

            // Arrival order
            const orderEl = cells[0].querySelector('.Small-TextLeft-Gray-100-Bold');
            const orderText = orderEl ? orderEl.textContent.trim() : '';
            const arrival_order = parseInt(orderText, 10) || null;

            // Team name and country
            const teamCell = cells[1];
            const nameEl = teamCell.querySelector('.TextLeft-Gray-100-Bold');
            const teamName = nameEl ? nameEl.textContent.trim() : '';
            const country = getCountryFromFlag(teamCell);

            // Ring description
            let ring = null;
            const ringContainer = teamCell.querySelector('.Small-TextLeft-Gray-70');
            if (ringContainer) {
                const spans = Array.from(ringContainer.querySelectorAll('span'));
                const ringSpan = spans.find(s => s.textContent && s.textContent.trim());
                if (ringSpan) {
                    ring = ringSpan.textContent.trim();
                }
            }

            // Arrival time
            const arrivalCell = cells[2];
            const arrivalRaw = arrivalCell ? arrivalCell.textContent : '';
            const arrival_time = parseArrivalTime(arrivalRaw);

            // Speed (if available)
            let speed = null;
            if (cells.length > 3) {
                const speedText = cells[3].textContent || '';
                const parsedSpeed = parseFloat(speedText);
                if (!Number.isNaN(parsedSpeed)) {
                    speed = parsedSpeed;
                }
            }

            if (!ring) {
                return null;
            }

            const pigeon_id = ring;

            return {
                pigeon_id: pigeon_id,
                arrival_order: arrival_order,
                arrival_time: arrival_time,
                speed: speed,
                pigeon: {
                    ring_description: ring,
                    pigeon_team: {
                        name: teamName,
                        country: country
                    }
                }
            };
        }

        function scanCurrentPageForNewPigeons() {
            // Prefer the currently visible data table, but fall back to any tbody rows
            let rows = [];
            const wrappers = Array.from(document.querySelectorAll('.v-data-table__wrapper'));
            const visibleWrapper = wrappers.find(w => w.offsetParent !== null && w.querySelector('table tbody'));
            if (visibleWrapper) {
                rows = Array.from(visibleWrapper.querySelectorAll('table tbody tr'));
            } else {
                rows = Array.from(document.querySelectorAll('table tbody tr'));
            }

            for (const row of rows) {
                const pigeon = parsePigeonRow(row);
                if (!pigeon || !pigeon.pigeon_id) continue;
                if (state.pigeons.some(p => p.pigeon_id === pigeon.pigeon_id)) continue;
                state.pigeons.push(pigeon);
            }
        }

        function getNextButton() {
            const buttons = Array.from(document.querySelectorAll('button[aria-label="Next page"]'));
            return buttons.find(btn => btn.offsetParent !== null);
        }

        function getPrevButton() {
            const buttons = Array.from(document.querySelectorAll('button[aria-label="Previous page"]'));
            return buttons.find(btn => btn.offsetParent !== null);
        }

        function isNextEnabled(btn) {
            if (!btn) return false;
            if (btn.disabled) return false;
            if (btn.getAttribute('aria-disabled') === 'true') return false;
            if (btn.classList.contains('v-btn--disabled')) return false;
            return true;
        }

        function getFirstArrivalOrderOnPage() {
            const wrappers = Array.from(document.querySelectorAll('.v-data-table__wrapper'));
            const visibleWrapper = wrappers.find(w => w.offsetParent !== null && w.querySelector('table tbody'));
            const root = visibleWrapper || document;
            const cell = root.querySelector('table tbody tr td .Small-TextLeft-Gray-100-Bold');
            if (!cell) return null;
            const txt = cell.textContent.trim();
            const num = parseInt(txt, 10);
            return Number.isNaN(num) ? null : num;
        }

        async function initialPaginationScan() {
            // Try to navigate back until we find the page where arrival_order starts at 1
            for (let i = 0; i < 200; i++) { // hard cap to avoid infinite loop
                const firstOrder = getFirstArrivalOrderOnPage();
                if (firstOrder === 1) break;
                const prevBtn = getPrevButton();
                if (!isNextEnabled(prevBtn)) break;
                prevBtn.click();
                await new Promise(resolve => setTimeout(resolve, 1000));
            }

            scanCurrentPageForNewPigeons();
            // Walk forward through pages until Next is no longer enabled
            // so we collect all current pigeons once.
            while (true) {
                const nextBtn = getNextButton();
                if (!isNextEnabled(nextBtn)) break;
                nextBtn.click();
                await new Promise(resolve => setTimeout(resolve, 1500));
                scanCurrentPageForNewPigeons();
            }
            state.initialScanDone = true;
            if (typeof win.onPigeonsBatchUpdated === 'function') {
                win.onPigeonsBatchUpdated(state.pigeons);
            }
        }

        // Kick off the initial full scan
        initialPaginationScan();

        const wrapper = document.querySelector('.v-data-table__wrapper');
        if (wrapper) {
            // Watch for new rows on the current page after the initial scan
            const observer = new MutationObserver(() => {
                if (!state.initialScanDone) return;
                const beforeCount = state.pigeons.length;
                scanCurrentPageForNewPigeons();
                if (state.pigeons.length !== beforeCount && typeof win.onPigeonsBatchUpdated === 'function') {
                    win.onPigeonsBatchUpdated(state.pigeons);
                }
            });
            observer.observe(wrapper, { childList: true, subtree: true, characterData: true });
        }

        // Every 5 seconds, check whether the Next button has become enabled
        // (i.e. new pages exist because more pigeons have arrived).
        setInterval(async () => {
            if (!state.initialScanDone) return;
            let nextBtn = getNextButton();
            if (!isNextEnabled(nextBtn)) return;

            // New page(s) are available, walk forward until we reach the end again.
            while (true) {
                nextBtn = getNextButton();
                if (!isNextEnabled(nextBtn)) break;
                nextBtn.click();
                await new Promise(resolve => setTimeout(resolve, 1500));
                scanCurrentPageForNewPigeons();
            }

            if (typeof win.onPigeonsBatchUpdated === 'function') {
                win.onPigeonsBatchUpdated(state.pigeons);
            }
        }, 5000);
    });

    // console.log('Attaching observer...');

    // Expose a Node function so page context can call back
    await page.exposeFunction('onArrivalsChanged', async (newValue) => {
        console.log('Detected change:', newValue);
        let arrivedBirds;
        if (!newValue || !newValue.includes('/')) {
            arrivedBirds = newValue || '0';
        } else {
            arrivedBirds = newValue.split('/')[0];
        }
        try {
            const res = await axios.post(baseUrl +'/api/events/update', {
                url: postData.url,
                new_arrivals: true,
                arrivedBirds: arrivedBirds
            });
            console.log('sending new arrivals value:', newValue);
            // console.log('POST success:', res.status);
        } catch (err) {
            console.error('POST failed:', err.message);
        }
    });

    // Inject MutationObserver on the data table wrapper; newValue = first Small-TextLeft-Gray-100-Bold in first tr
    await page.evaluate(() => {
        console.log('mutation observer started');
        const wrapper = document.querySelector('.v-data-table__wrapper');
        if (!wrapper || !wrapper.querySelector('table')) {
            console.warn('v-data-table__wrapper or its table not found');
            return;
        }

        function getFirstCellValue() {
            const cell = wrapper.querySelector('tr .Small-TextLeft-Gray-100-Bold');
            return cell ? cell.textContent.trim() : '';
        }

        let lastValue = getFirstCellValue();
        console.log('lastValue (first Small-TextLeft-Gray-100-Bold in first tr):', lastValue);

        const observer = new MutationObserver(() => {
            const newValue = getFirstCellValue();
            if (newValue !== lastValue) {
                lastValue = newValue;
                window.onArrivalsChanged(newValue);
            }
        });

        observer.observe(wrapper, { childList: true, subtree: true, characterData: true });
    });

    // console.log('👀 Watching for Arrivals changes... (press Ctrl+C to stop)');

    setTimeout(async () => {
        console.log("⏰ Restarting watcher...");
        await browser.close();
        startWatcher(); 
    }, 15 * 60 * 1000);
};

startWatcher();
