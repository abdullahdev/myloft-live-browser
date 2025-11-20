const puppeteer = require('puppeteer');
const axios = require('axios');
const baseUrl = 'https://live.myloft.ro';
// const baseUrl = 'http://127.0.0.1:8000';
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

    const distanceKm = distance ? parseInt(distance.match(/\d+/)?.[0] || '0', 10) : null;

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

    console.log('✅ Extracted data:');
    console.log('   Title:', title);
    console.log('   Date/Time (original):', dateTime);
    console.log('   Date/Time (UTC):', dateTimeUtc);
    console.log('   Distance:', distanceKm);
    console.log('   Location:', location);
    console.log('   URL:', url);

   

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
    const totalBirds = arrivalsValue.split('/')[1];
    
     // Initial API call with extracted data
     try {
        const res = await axios.post(baseUrl + '/api/events/update', {
            url: url,
            title: title,
            dateTime: dateTimeUtc,
            distance: distanceKm.toString(),
            location: location,
            totalBirds: totalBirds
        });
        console.log('✅ Initial POST success:', res.status);
    } catch (err) {
        console.error('❌ Initial POST failed:', err.message);
    }
    // console.log('Attaching observer...');

    // Expose a Node function so page context can call back
    await page.exposeFunction('onArrivalsChanged', async (newValue) => {
        // console.log('Detected change:', newValue);

        try {
            const res = await axios.post(baseUrl +'/api/events/update', {
                value: newValue
            });
            console.log('sending new arrivals value:', newValue);
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
        console.log("⏰ Restarting watcher...");
        await browser.close();
        startWatcher(); 
    }, 5 * 60 * 1000);
};

startWatcher();
