/* global $ */
const Apify = require('apify');
const querystring = require('querystring');
const _ = require('lodash');

const { sleep, log } = Apify.utils;
const { DEFAULT_TIMEOUT, LISTING_PAGINATION_KEY, PLACE_TITLE_SEL } = require('./consts');
const { waitForGoogleMapLoader, parseSearchPlacesResponseBody, getValidKey, saveHTML, saveScreenshot } = require('./utils');

/**
 * This handler waiting for response from xhr and enqueue places from the search response body.
 * @param params
 * @param params.requestQueue
 * @param params.input
 * @param params.request
 * @return {Function}
 */
const enqueuePlacesFromResponse = ({ requestQueue, input, request }) => {
    const { maxCrawledPlaces } = input;
    const { searchString } = request.userData;

    return async (response) => {
        const url = response.url();
        if (url.startsWith('https://www.google.com/search')) {
            const allPlacesRequestKey = getValidKey({ str: `search_founded_places_requests__${request.uniqueKey}`, replaceChar: '_' });
            const allPlacesRequests = await Apify.getValue(allPlacesRequestKey) || [];
            // Parse page number from request url
            const queryParams = querystring.parse(url.split('?')[1]);
            const pageNumber = parseInt(queryParams.ech);
            // Parse place ids from response body
            const responseBody = await response.buffer();
            const places = parseSearchPlacesResponseBody(responseBody);
            const enqueuePromises = [];
            if (input.onlySearch) {
                return;
            }
            places.forEach((place, index) => {
                const rank = ((pageNumber - 1) * 20) + (index + 1);
                if (!maxCrawledPlaces || rank <= maxCrawledPlaces) {
                    const placeRequest = {
                        url: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(searchString)}&query_place_id=${place.placeId}`,
                        uniqueKey: getValidKey({ str: `${searchString.toUpperCase()}__${place.placeId}`, replaceChar: '_' }),
                        // userData: { ...request.userData, label: 'detail', rank },
                        userData: { ..._.omit(request.userData, ['currentPageCache']), label: 'detail', placeId: place.placeId, rank },
                    };
                    allPlacesRequests.push(placeRequest);
                    const promise = requestQueue.addRequest(placeRequest);
                    enqueuePromises.push(promise);
                }
            });
            await Promise.all(enqueuePromises);
            await Apify.setValue(allPlacesRequestKey, allPlacesRequests);
        }
    };
};

/**
 * Method adds places from listing to queue
 * @param params
 * @param params.page
 * @param params.requestQueue
 * @param params.input
 * @param params.request
 */
const enqueueAllPlaceDetails = async ({ page, requestQueue, input, request }) => {
    const { maxCrawledPlaces } = input;
    const { searchString } = request.userData;
    page.on('response', enqueuePlacesFromResponse({
        requestQueue,
        input,
        request,
    }));
    // Save state of listing pagination
    // NOTE: If pageFunction failed crawler skipped already scraped pagination
    const listingStateKey = getValidKey({ str: `${LISTING_PAGINATION_KEY}_${searchString}`, replaceChar: '_', toUpperCase: true });
    const listingPagination = await Apify.getValue(listingStateKey) || {};

    const currentPageCacheKey = getValidKey({ str: `current_page_cache__${request.uniqueKey}`, replaceChar: '_' });
    const currentPageCache = await Apify.getValue(currentPageCacheKey);

    if (currentPageCache) {
        console.log(`Loading the page from the cache for search "${searchString}" (Continue from where we left or the request failed).`);
        await page.setContent(currentPageCache);
    } else {
        await page.type('#searchboxinput', searchString);
        await sleep(5000);
        const searchStringFromInput = await page.$eval('#searchboxinput', el => el.value);
        const isSearchStringTypedCorrectly = searchStringFromInput === searchString;
        if (!isSearchStringTypedCorrectly) {
            // log.info(`The search string in the search box input is: "${searchStringFromInput}", and the typed one is: "${searchString}"`);
            // console.log('******\nThe search string in the search box is different from the typed one.\n******');
            throw new Error(`The search string in the search box input (${searchStringFromInput})`
                + ` is different from the typed one (${searchString})!`);
        }
        await page.click('#searchbox-searchbutton');
        await sleep(5000);
    }
    await waitForGoogleMapLoader(page);
    try {
        await page.waitForSelector(PLACE_TITLE_SEL);
        // It there is place detail, it means there is just one detail and it was redirected here.
        // We do not need enqueue other places.
        log.debug(`Search string ${searchString} has just one place to scraper.`);
        return;
    } catch (e) {
        // It can happen if there is list of details.
    }

    // In case there is a list of details, it goes through details, limits by maxPlacesPerCrawl
    const nextButtonSelector = '[jsaction="pane.paginationSection.nextPage"]';
    while (true) {
        const noResultsEl = await page.$('.section-no-result-title');
        if (noResultsEl) {
            break;
        }
        await page.waitForSelector(nextButtonSelector, { timeout: DEFAULT_TIMEOUT });
        // const paginationText = await page.$eval('.n7lv7yjyC35__root', el => el.innerText);
        const paginationText = await page.$eval("[class*='Pagination__root']", el => el.innerText);
        const [fromString, toString] = paginationText.match(/\d+/g);
        const from = parseInt(fromString);
        const to = parseInt(toString);
        log.debug(`Added links for search "${searchString}" from pagination ${from} - ${to}`);
        listingPagination.from = from;
        listingPagination.to = to;
        await Apify.setValue(listingStateKey, listingPagination);
        await Apify.setValue(currentPageCacheKey, await page.content());
        if (log.getLevel() === log.LEVELS.DEBUG) {
            const preKey = getValidKey({ str: `${request.uniqueKey}--${from}-${to}` });
            await saveHTML(page, `${preKey}.html`);
            await saveScreenshot(page, `${preKey}.png`);
        }
        await page.waitForSelector(nextButtonSelector, { timeout: DEFAULT_TIMEOUT });
        const isNextPaginationDisabled = await page.evaluate((nextButtonSelector) => {
            return !!$(nextButtonSelector).attr('disabled');
        }, nextButtonSelector);
        if (isNextPaginationDisabled || (maxCrawledPlaces && maxCrawledPlaces <= to)) {
            break;
        } else {
            // NOTE: puppeteer API click() didn't work :|
            await page.evaluate(sel => $(sel).click(), nextButtonSelector);
            await waitForGoogleMapLoader(page);
        }
    }

    listingPagination.isFinish = true;
    page.removeListener('request', enqueuePlacesFromResponse);
    await Apify.setValue(listingStateKey, listingPagination);
};

module.exports = { enqueueAllPlaceDetails };
