const Apify = require('apify');
const placesCrawler = require('./places_crawler');
const { LANGUAGE_CODES, CURRENCY_COUNTRIES } = require('./consts');
const { readAndValidateSpreadsheet, saveDataToKVS, getValidKey } = require('./utils');

const { log } = Apify.utils;




Apify.main(async () => {
    const browser = await Apify.launchPuppeteer();
    const page = await browser.newPage();

    const input = await Apify.getValue('INPUT');

    const {
        spreadsheetId,
        publicSpreadsheet,
        proxyConfig,
        debug = true,
        languageCode,
        currencyCountry,
    } = input;

    if (debug) {
        log.setLevel(log.LEVELS.DEBUG);
    }
    if (!spreadsheetId) throw new Error('Input attribute "spreadsheetId"" is missing in input.');
    if (proxyConfig && proxyConfig.apifyProxyGroups
        && (proxyConfig.apifyProxyGroups.includes('GOOGLESERP') || proxyConfig.apifyProxyGroups.includes('GOOGLE_SERP'))) {
        throw new Error('It is not possible to crawl google places with GOOGLE SERP proxy group. Please use a different one and rerun crawler.');
    }
    if (!LANGUAGE_CODES.includes(languageCode)) throw new Error('Input attribute "languageCode is missing or not valid.');
    if (!CURRENCY_COUNTRIES.includes(currencyCountry)) throw new Error('Input attribute "currencyCountry is missing or not valid.');

    log.info(`Scraping Google Places using:
- Spreadsheet ID: ${spreadsheetId} ${publicSpreadsheet ? '(Public)' : ''}
- Language: ${languageCode}
- Currency country: ${currencyCountry}`);

    const startRequests = [];

    const searchesArray = await readAndValidateSpreadsheet(spreadsheetId, publicSpreadsheet);
    // console.log("***********  searchesArray   **************");
    // console.log(searchesArray);


    for (const search of searchesArray) {
        let { placeId, placeUrl, searchUrl, city, country, category, searchString } = search;
        
        /******  Get redirect url   *****************/
        await page.goto(placeUrl, {
          waitUntil: "networkidle0",
          timeout: 0,
        });
        const redirectUrl = await page.url();
        placeUrl=redirectUrl;
        console.log("***** redirectUrl === ",redirectUrl);
        console.log("***** placeUrl === ",placeUrl);

        const url = `${searchString ? 'https://www.google.com/maps/search/' : searchUrl}`;
        const uniqueKey = getValidKey({
            str: searchString || searchUrl.replace(/(http[s]?:\/\/www.google.(.*)\/maps\/place\/)/g, ''),
            replaceChar: '_',
        });
        const label = searchUrl ? 'placeUrl' : 'startUrl';
        startRequests.push({
            url,
            uniqueKey,
            userData: {
                label,
                placeId,
                placeUrl,
                // redirectUrl,
                city,
                country,
                category,
                searchString,
            },
        });
    }

    await Apify.setValue('START_REQUESTS', startRequests);
    const requestQueue = await Apify.openRequestQueue();

    for (const request of startRequests) {
        await requestQueue.addRequest(request);
    }

    // Create and run crawler
    const crawler = await placesCrawler.setUpCrawler({
        requestQueue,
        input,
        languageCode,
        currencyCountry,
    });
    let runError;
    try {
        await crawler.run();
    } catch (e) {
        runError = e;
    }
    await saveDataToKVS(input);
    if (runError) {
        throw runError;
    }
    log.info('Done!');
});
