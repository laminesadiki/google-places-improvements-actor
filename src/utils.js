const Apify = require('apify');
const XLSX = require('xlsx');
const _ = require('lodash');

const { DEFAULT_TIMEOUT } = require('./consts');

const { requestAsBrowser } = Apify.utils;

const getValidKey = ({ str, replaceChar = '', toUpperCase = false, length = 256 }) => {
    let strKey = str.replace(/[^[a-zA-Z0-9!\-_.'()]/g, replaceChar);
    strKey = strKey.substring(0, length);
    if (toUpperCase) {
        strKey = strKey.toUpperCase();
    }
    return strKey;
};

const getProxyInfo = async (proxyUrl) => {
    const { statusCode, body } = await requestAsBrowser({
        url: 'https://api.apify.com/v2/browser-info',
        proxyUrl,
        json: true,
        abortFunction: () => false,
    });
    if (statusCode !== 200) throw new Error(`Wrong response status code ${statusCode}`);
    return body;
};

/**
 * Store screen from puppeteer page to Apify key-value store
 * @param page - Instance of puppeteer Page class https://github.com/GoogleChrome/puppeteer/blob/master/docs/api.md#class-page
 * @param [key] - Function stores your screen in Apify key-value store under this key
 * @return {Promise<void>}
 */
const saveScreenshot = async (page, key = 'OUTPUT') => {
    const screenshotBuffer = await page.screenshot({ fullPage: true });
    await Apify.setValue(key, screenshotBuffer, { contentType: 'image/png' });
};

/**
 * Store HTML content of page to Apify key-value store
 * @param page - Instance of puppeteer Page class https://github.com/GoogleChrome/puppeteer/blob/master/docs/api.md#class-page
 * @param [key] - Function stores your HTML in Apify key-value store under this key
 * @return {Promise<void>}
 */
const saveHTML = async (page, key = 'OUTPUT') => {
    const html = await page.content();
    await Apify.setValue(key, html, { contentType: 'text/html; charset=utf-8' });
};

/**
 * Wait until google map loader disappear
 * @param page
 * @return {Promise<void>}
 */
const waitForGoogleMapLoader = async (page) => {
    if (await page.$('#searchbox')) {
        await page.waitFor(() => !document.querySelector('#searchbox')
            .classList.contains('loading'), { timeout: DEFAULT_TIMEOUT });
    }
    // 2019-05-19: New progress bar
    await page.waitFor(() => !document.querySelector('.loading-pane-section-loading'), { timeout: DEFAULT_TIMEOUT });
};

const stringifyGoogleXrhResponse = (googleResponseString) => {
    return JSON.parse(googleResponseString.replace(')]}\'', ''));
};

/**
 * Response from google xhr is kind a weird. Mix of array of array.
 * This function parse places from the response body.
 * @param responseBodyBuffer
 * @return [place]
 */
const parseSearchPlacesResponseBody = (responseBodyBuffer) => {
    const places = [];
    const jsonString = responseBodyBuffer
        .toString('utf-8')
        .replace('/*""*/', '');
    const jsonObject = JSON.parse(jsonString);
    const magicParamD = stringifyGoogleXrhResponse(jsonObject.d);
    const results = magicParamD[0][1];
    results.forEach((result) => {
        if (result[14] && result[14][11]) {
            const place = result[14];
            places.push({ placeId: place[78] });
        }
    });
    return places;
};

/**
 * Shuffles array in place. ES6 version
 * @param {Array} a items An array containing the items.
 */
function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

const readAndValidateSpreadsheet = async (spreadsheetId, publicSpreadsheet,page) => {
    const actorRun = await Apify.call('lukaskrivka/google-sheets', {
        mode: 'read',
        spreadsheetId,
        publicSpreadsheet,
    }, { memoryMbytes: 512 });
    if (actorRun.status !== 'SUCCEEDED') {
        throw Error(`Failed to read the spreadsheet ${spreadsheetId}. See the log here for more info https://my.apify.com/view/runs/${actorRun.id}`);
    }

    const { output: { body: data } } = actorRun;
    if (!Array.isArray(data) || !data.length) {
        throw Error('The data in the spreadsheet is not valid!');
    }

    const searchesArray = [];
    for (let i = 0; i < data.length; i++) {
        let { 'Google Place ID': placeId, 'Google Place URL': placeUrl, City, Country, Category } = data[i];

        if (placeId) {
            let SearchUrlWithPlaceId =  `https://www.google.com/maps/search/?api=1&query=${placeId.replace(/\s+/g, '')}&query_place_id=${placeId}`;
            await page.goto(SearchUrlWithPlaceId, {
                waitUntil: "networkidle0",
                // timeout: 60*1000
                timeout: 0
            });
            // await page.waitForNavigation({waitUntil :"networkidle0",timeout: 0});
            const redirectUrl1 = await page.url();
            console.log("*****     redirectUrl from PlaceId     === ",redirectUrl1);
            searchesArray.push({
                placeId,
                searchUrl: redirectUrl1,
                // searchUrl: `https://www.google.com/maps/search/?api=1&query=${placeId.replace(/\s+/g, '')}&query_place_id=${placeId}`,
            });
        } else if (placeUrl) {
            const m = placeUrl.match(/http[s]?:\/\/www.google.(.*)\/maps\//g)
             || placeUrl.match(/http[s]?:\/\/maps.google.(.*)\//g);
            if (!m) {
                throw Error(`Wrong URL in the spreadsheet (${spreadsheetId}): row=${i + 2}, Place URL=${placeUrl}`);
            }
            

            await page.goto(placeUrl, {
                waitUntil: "networkidle0",
                // timeout: 60*1000
                timeout: 0
            });
            // await page.waitForNavigation({waitUntil :"networkidle0",timeout: 60*1000});
            const redirectUrl = await page.url();
            console.log("*****     redirectUrl from PlaceUrl     === ",redirectUrl);

            searchesArray.push({
                placeUrl,
                searchUrl: redirectUrl,
                // searchUrl: placeUrl,
            });
        } else {
            if (!Category || !Country) {
                throw Error(`Missing data in the spreadsheet (${spreadsheetId}): row=${i + 2}, City=${City}, Country=${Country}, Category=${Category}`);
            }
            searchesArray.push({
                city: City,
                country: Country,
                category: Category,
                searchString: `${Category} in ${City ? `${City}, ` : ''}${Country}`,
            });
        }
    }
    shuffle(searchesArray);
    return searchesArray;
};


const getXlsxBufferFrom = (rows) => {
    const workBook = XLSX.utils.book_new();
    const workSheet = XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(workBook, workSheet, 'Result Sheet');
    return XLSX.write(workBook, { type: 'buffer', bookType: 'xlsx' });
};

function transformPlacesToXlsxRows(places) {
    const cleanPlaces = places.map(place => _.omit(place, ['debug']));
    const defaultCleanPlaceKeys = ['placeId', 'placeUrl', 'name', 'rating', 'reviewsNumber',
        'city', 'country', 'address', 'category', 'plusCode', 'website', 'phoneNumber', 'claimed'];

    const extraPlaceKeys = cleanPlaces.reduce((previousValue, currentValue) => {
        const extraCurrentPlaceKeys = Object.keys(_.omit(currentValue, defaultCleanPlaceKeys));
        return _.union(previousValue, extraCurrentPlaceKeys);
    }, []);


    const columnNamesRow = ['Place ID', 'Place URL', 'Place Name', 'Rating', 'Reviews Number',
        'City', 'Country', 'Address', 'Category', 'Plus Code', 'Website', 'Phone Number', 'Claimed', ...extraPlaceKeys];
    const placesRows = cleanPlaces.map((item) => {
        const placeRow = [item.placeId, item.placeUrl, item.name, item.rating, item.reviewsNumber,
            item.city, item.country, item.address, item.category, item.plusCode, item.website, item.phoneNumber, item.claimed ? 'true' : 'false'];

        placeRow.push(...extraPlaceKeys.map(extraPlaceKey => item[extraPlaceKey]));
        return placeRow;
    });
    return [
        columnNamesRow,
        ...placesRows,
    ];
}

const saveDataToKVS = async (input) => {
    let { saveToOneFile } = input;
    const dataset = await Apify.openDataset();
    const kvs = await Apify.openKeyValueStore();
    const allPlaces = await dataset.getData().then(data => data.items);

    const firstPlace = allPlaces[0];
    if (!firstPlace.searchString) {
        saveToOneFile = true;
    }
    const filesUrls = [];
    const fileExtension = '.xlsx';
    if (saveToOneFile) {
        const rows = transformPlacesToXlsxRows(allPlaces);
        const xlsxBuffer = getXlsxBufferFrom(rows);
        const ALL_IN_ONE_FILE_KVS_KEY = `ALL_IN_ONE_FILE${fileExtension}`;
        await kvs.setValue(ALL_IN_ONE_FILE_KVS_KEY, xlsxBuffer, { contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const url = `${kvs.getPublicUrl(ALL_IN_ONE_FILE_KVS_KEY)}?disableRedirect=true`;
        filesUrls.push(url);
    } else {
        const groupsBySearchString = allPlaces.reduce((acc, item) => {
            if (!acc[item.searchString]) {
                acc[item.searchString] = [];
            }

            acc[item.searchString].push(item);
            return acc;
        }, {});

        for (const [searchString, places] of Object.entries(groupsBySearchString)) {
            const rows = transformPlacesToXlsxRows(places);
            const xlsxBuffer = getXlsxBufferFrom(rows);
            const fileKvsKey = getValidKey({ str: searchString, replaceChar: '_', toUpperCase: true }) + fileExtension;
            await kvs.setValue(
                fileKvsKey,
                xlsxBuffer,
                { contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
            );
            const url = `${kvs.getPublicUrl(fileKvsKey)}?disableRedirect=true`;
            filesUrls.push(url);
        }
    }

    await kvs.setValue('OUTPUT', filesUrls);
};

module.exports = {
    readAndValidateSpreadsheet,
    saveScreenshot,
    saveHTML,
    waitForGoogleMapLoader,
    parseSearchPlacesResponseBody,
    saveDataToKVS,
    getProxyInfo,
    getValidKey,
};
