/* global $ */
const Apify = require('apify');
const Globalize = require('globalize');
const _ = require('lodash');
const fs = require('fs');

const DEFAULT_CRAWLER_LOCALIZATION = ['en', 'fr'];

Globalize.load(require('cldr-data').entireSupplemental());
Globalize.load(require('cldr-data').entireMainFor(...DEFAULT_CRAWLER_LOCALIZATION));

const { log } = Apify.utils;
const { injectJQuery, blockRequests } = Apify.utils.puppeteer;
const { MAX_PAGE_RETRIES, DEFAULT_TIMEOUT, PLACE_TITLE_SEL } = require('./consts');
const { enqueueAllPlaceDetails } = require('./enqueue_places_crawler');
const { getProxyInfo, saveHTML, saveScreenshot, waitForGoogleMapLoader, getValidKey } = require('./utils');

function parseCity(detail) {
    const { address: unmodifiedAddress, plusCode } = detail;
    if (plusCode) {
        return plusCode.split(',')[0].split(' ').slice(1).join(' ');
    }
    if (!unmodifiedAddress) {
        return null;
        // throw new Error('Address must be a non-empty string.');
    }
    let cityString;
    try {
        const address = unmodifiedAddress.split('\n')[0].replace(/  +/g, ' ');
        // Assume comma is an intentional delimiter
        const addressParts = address.split(',');
        // Remove country
        addressParts.splice(-1, 1);
        // Assume the last address section contains city, zip or both
        cityString = addressParts[addressParts.length - 1].trim();
        // Parse and remove zip from the end of string
        if (cityString.match(/\d{5}$/)) {
            cityString = cityString.substring(0, cityString.length - 5).trim();
        }
        
    } catch (error) {
        cityString="";
    }
    
    return cityString;
}

function parseCountry(detail) {
    const { address: unmodifiedAddress, plusCode } = detail;
    if (plusCode) {
        return plusCode.split(',')[plusCode.split(',').length - 1].trim();
    }
    if (!unmodifiedAddress) {
        return null;
        // throw new Error('Address must be a non-empty string.');
    }
    const address = unmodifiedAddress.split('\n')[0].replace(/  +/g, ' ');
    // Assume comma is an intentional delimiter
    const addressParts = address.split(',');

    return addressParts.splice(-1, 1)[0];
}

/**
 * This is the worst part - parsing data from place detail
 * @param params
 * @param params.page
 * @param params.request
 */
const extractPlaceDetail = async ({ page, request }) => {
    // Extract basic information
    await waitForGoogleMapLoader(page);
    await page.waitForSelector(PLACE_TITLE_SEL, { timeout: DEFAULT_TIMEOUT });
    const detail = await page.evaluate((placeTitleSel) => {
        let selectorsType = 'data-item-id';
        let addressSelector = '[data-item-id="address"]';
        let secondaryAddressSelector = '[data-item-id="laddress"]';
        let phoneNumberSelector = '[data-item-id*="phone"]';
        let phoneNumberAttributeName = 'data-item-id';
        let plusCodeSelector = '[data-item-id="oloc"]';
        let websiteSelector = '[data-item-id="authority"]';
        let claimedSelector = '[data-item-id="merchant"]';
        // if ($('[data-section-id]:not([data-section-id="al"])').length) {
        if (!$('[data-item-id]').length) {
            selectorsType = 'data-section-id';
            addressSelector = '[data-section-id="ad"] .section-info-line';
            secondaryAddressSelector = '[data-section-id="ad"] .section-info-secondary-text';
            phoneNumberSelector = '[data-section-id="pn0"].section-info-speak-numeral';
            phoneNumberAttributeName = 'data-href';
            plusCodeSelector = '[data-section-id="ol"] .widget-pane-link';
            websiteSelector = '[data-section-id="ap"]';
            claimedSelector = '[data-section-id="mcta"] .widget-pane-link:not([style])';
        }
        let address = $(addressSelector).text().trim();
        const $secondaryAddressLine = $(secondaryAddressSelector);
        if (address && $secondaryAddressLine.length) {
            address += `\n${$secondaryAddressLine.text().trim()}`;
        }
        const $website = $(websiteSelector);
        const $phoneNumber = $(phoneNumberSelector);
        const $hotelsAdsContainer = $('.section-hotel-prices-booking-container');
        
        // Get category for hotels
        // let categoryHotel;
        // if([...document.querySelectorAll('[class="section-rating-term"]')].map(el => el.innerText)[1] != null ){
        //     categoryHotel=[...document.querySelectorAll('[class="section-rating-term"]')].map(el => el.innerText)[1].substring(1).split(" ")[0];
        // }

        
        
        //Get stars of hotêl
        let HotelStars;
        try {
            HotelStars = [...document.querySelectorAll('span[jsaction="pane.rating.moreReviews"]')][1].innerText.trim().match(/(\d+)/g)[0];
        } catch (error) {
            HotelStars="";
            }   
        

        return {
            title: $(placeTitleSel).text().trim(),
            rating: $("[class*='section-star-display']").eq(0).text().trim(),
            // category: $('[jsaction="pane.rating.category"]').text().trim() ,//|| $$('[class="section-rating-term"]').map(el => el.innerText)[1],
            category: $('[jsaction="pane.rating.category"]').text().trim() ,
            stars : HotelStars,       
            address,
            business_status : $("span[class*='section-info-hour-text']").text().trim(),
            plusCode: $(plusCodeSelector).text().trim(),
            website: $website.length ? $website.eq('0').text().trim() : null,
            // pointsforts : {...document.querySelector("div.uDxUUUCO4ji__container").innerText.trim().split("\n")},
            //pointsForts : $("div.uDxUUUCO4ji__container").text().trim() || "Le vide hahahaha",
            //pointsforts : "ayoub test ",
            phoneNumber: $phoneNumber.length
                ? $phoneNumber.attr(phoneNumberAttributeName)
                    .replace(/[.]*tel:/g, '')
                    .replace('phone:', '')
                : null,
            claimed: $(claimedSelector).length === 0,
            selectorsType,
            isHotelsAdsExist: $hotelsAdsContainer.length > 0,
            amentiesHotel : {...[...document.querySelectorAll("div.section-hotel-amenities-hotel-amenity")].map(el =>{ 
                if(el.hasAttribute("aria-disabled")) return "";
                else 
                     return el.innerText.trim() ; })},
        };
    }, PLACE_TITLE_SEL);

    // Add info from listing page or extract it
    detail.placeId = request.userData.placeId;
    if (!detail.placeId) {
        detail.placeId = await page.evaluate(() => {
            try {
                const parsedArray = JSON.parse(window.APP_INITIALIZATION_STATE[3][6].replace(/((\)]})|')/g, ''));
                return parsedArray[6].slice(78, 82)
                    .filter(el => typeof el === 'string' && el.length > 20 && !el.includes('/'))[0];
            } catch (e) {
                return null;
            }
        });
    }

    // Extract gps from URL
    // We need to wait for the URL to be changed, it happened asynchronously
    await page.waitForFunction(() => {
        const url = window.location.href;
        if (!url.includes('/place/')) return false;
        const match = url.match(/!3d(.*)!4d(.*)/);
        return !!match;
    });
    const url = await page.url();
    detail.url = url.replace(/\?hl=(.)*(&gl=(.*))?/g, '');
    // eslint-disable-next-line no-unused-vars
    // const [fullMatch, latMatch, lngMatch] = url.match(/\/@(.*),(.*)[[,]|[,[.*]]?\//) || url.match(/!3d(.*)!4d(.*)/);
    // const [fullMatch, latMatch, lngMatch] = url.match(/!3d(.*)!4d(.*)/);
    // const [fullMatch, latMatch, lngMatch] = url.match(/!3d([0-9\-.]+)!4d([0-9\-.]+)/);
    // if (latMatch && lngMatch) {
    //     detail.location = { lat: parseFloat(latMatch), lng: parseFloat(lngMatch) };
    // }

    let locationMatch = url.match(/!3d([0-9\-.]+)!4d([0-9\-.]+)/);
    // console.log(locationMatch);
    const latMatch = locationMatch ? locationMatch[1] : null;
    const lngMatch = locationMatch ? locationMatch[2] : null;
    const location = latMatch && lngMatch ? { latitude: parseFloat(latMatch), longitude: parseFloat(lngMatch) } : null
    // console.log(location);

    const reviewsButtonSel = 'button[jsaction="pane.reviewChart.moreReviews"]';
    if (detail.rating) {
        const { reviewsNumberText, localization } = await page.evaluate((selector) => {
            const numberReviewsText = $(selector)
                .text()
                .trim();
            // NOTE: Needs handle:
            // Recenze: 7
            // 1.609 reviews
            // 9 reviews
            const number = numberReviewsText.match(/[.,0-9]+/);
            const lang = document.querySelector('html').getAttribute('lang');
            return {
                reviewsNumberText: number ? number[0] : null,
                localization: (lang || navigator.language).slice(0, 2),
            };
        }, reviewsButtonSel);
        let globalParser;
        try {
            globalParser = Globalize(localization);
        } catch (e) {
            throw new Error(`Cannot find localization for ${localization}, try to use different proxy IP.`);
        }
        detail.rating = globalParser.numberParser({ round: 'floor' })(detail.rating);
        detail.reviewsNumber = reviewsNumberText ? globalParser.numberParser({ round: 'truncate' })(reviewsNumberText) : null;
    }

    if (detail.isHotelsAdsExist) {
        const showMoreHotelsAdButtonSelector = '.section-hotel-prices-booking-container > button:not([style])';
        const $showMoreButton = await page.$(showMoreHotelsAdButtonSelector);
        if ($showMoreButton) {
            try {
                await page.click(showMoreHotelsAdButtonSelector);
            } catch (error) {
                
            }
           
        }
        const hotelsAds = await page.evaluate(() => {
            const $adsInfo = $('.section-hotel-prices-section ,[class*="partner-container"]');
            const hotelsAds = [];
            $adsInfo.each((index, el) => {
                const name = $(el)
                    .find('[class*="partner-name-container"]')
                    .text()
                    .trim();
                const price = $(el)
                    .find('[class*="primary-display-price-text"]')
                    .text()
                    .trim();
                hotelsAds.push({
                    name,
                    price,
                });
            });
            return hotelsAds;
        });

        detail.hotelsAds = {};
        detail.hotelsAds['booking.com'] = null;
        detail.hotelsAds['hotels.com'] = null;
        detail.hotelsAds['expedia.com'] = null;
        detail.hotelsAds['travago.fr'] = null;
        detail.hotelsAds['ebookers.ie'] = null;
        detail.hotelsAds['stayforlong.com'] = null;
        detail.hotelsAds['trip.com'] = null;
        detail.hotelsAds['agoda.com'] = null;
        detail.hotelsAds['zenhotels.com'] = null;
        detail.hotelsAds['etrip.net'] = null;
        detail.hotelsAds['findhotel.net'] = null;
        detail.hotelsAds['prestigia.com'] = null;
        detail.hotelsAds['travellergram.com'] = null;
        for (const { name, price } of hotelsAds) {
            if (!name || !price) {
                log.warning(`Extra hotel price: ${detail.url}`);
                // eslint-disable-next-line no-continue
                continue;
            }
            detail.hotelsAds[name.toLowerCase()] = price;
        }
    }

    // Include data from request
    const { userData } = request;
    detail.city = userData.city || parseCity(detail);
    detail.country = userData.country || parseCountry(detail);
    detail.category = detail.category || userData.category;
    detail.searchString = userData.searchString;

    if (log.getLevel() === log.LEVELS.DEBUG) {
        detail.html = await page.content();
    }

    //get latitude & longitude
    // method 1 : didn't work correctly
    // await page.mouse.click(700,500,{
    //     button:"right",
    //   });
    // await page.waitForSelector('[class="action-menu-entry-text"]');
    // let latLongList= await page.$eval('[class="action-menu-entry-text"]', el => el.innerText.split(","));
    // // console.log(latLongList);
    // let latLongObj={latitude : latLongList[0],longitude:latLongList[1]};
    // console.log(latLongObj);

    // get Points Forts for hotels
    let pointsforts;
    let highlightSelector = await page.$eval("h2.section-subheader-header",el => el.innerText);
    if (highlightSelector == "Points forts" || highlightSelector == "Highlights" ){
    try {
        // await page.waitForSelector("div[class*='Hoteljustification__text']");
        // await page.waitForNavigation();
        let pointsfortsList = await page.evaluate(() => {
            let pointsFortsDOM = [...document.querySelectorAll("div[class*='Hoteljustification__text']")].map(el => el.innerText);
            return pointsFortsDOM;
        });
        pointsforts=pointsfortsList;

    } catch (error) { 
        pointsforts=[];
    }
    
    // let pointsfortsList = await page.$eval("div.uDxUUUCO4ji__container",el => el.innerText.trim().split("\n"));
    
    
    // pointsforts={...pointsfortsList}
    
    // console.log(pointsforts);
    }

    // Get numberOfReviews
    let numberOfReviews = await page.evaluate(() => {
        try {
            let reviewsNumber = document.querySelector('button[jsaction="pane.rating.moreReviews"]').innerText.match(/(\d+,?)+/g)[0];
            return reviewsNumber;
        } catch (error) {
            return null;
        }

        
    });




    //get hotel descriptionHotel
    let descriptionHotel;
    let isBtnPlusExist=await page.$("button.section-hotel-details-more");

    if(isBtnPlusExist != null){
    try {
        await page.waitForSelector('button.section-hotel-details-more'); 

        //  await page.$$eval("button.section-hotel-details-more", el => el.click());
        await page.$eval("button.section-hotel-details-more", el => el.click());

        await page.waitForTimeout(5000);

        await page.waitForSelector("div.section-hotel-details-text-all");
        
        descriptionHotel = await page.evaluate(() => {return [...document.querySelectorAll("div.section-hotel-details-text-all")].map(el => el.innerText).join("\n")});
        // console.log("*********** descriptionHotel 1 ************* \n",descriptionHotel);
    } catch (error) {
        descriptionHotel="";
    }
    

    }


    // get Place(Restaurant || PlaceTouristique) Description and Details
    let descriptionPlace;
    let amentiesPlace;
    let amentiesPlaceObj;
    const arrayToObject = (arr) => Object.assign({}, ...arr);
    if(await page.$("button[class*='section-editorial']")!= null){
        // await page.click("button.section-editorial.GLOBAL__gm2-body-2");
        // click button to get description & amenties
        await page.$eval("button[class*='section-editorial']",el => el.click());
        // await page.waitForSelector("span.section-text-description-text");
        await page.waitForTimeout(5000);
        descriptionPlace= await page.$("span.section-text-description-text")!=null ? await page.$eval("span.section-text-description-text",el => el.innerText) : "";
        amentiesPlace = await page.$$eval(".section-attribute-group",options => options
          .map(el =>{
            let title =el.querySelector("div.section-attribute-group-title").innerText;
            let content = [...el.querySelectorAll("[class*='section-attribute-group-container'] > li")].map(el => el.innerText).join(" ;\n ");
            return {[title]:content};
          }));
        amentiesPlaceObj=arrayToObject(amentiesPlace);
        //   console.log(amentiesPlaceObj);
        await page.goto(url,{
            waitUntil:'networkidle0',
            timeout:0 ,  
        });

    }

//************************************

    // get review tags (families 5,4 , couples 3,1,.....);
    let tags={};
    let arr=[];
    let refineReviews;
    let starsPerReviews;
    // await page.waitForSelector("button.gm2-button-alt");
    if(await page.$("button.gm2-button-alt")!= null){
    // await page.click("button.gm2-button-alt");
    await page.$eval("button.gm2-button-alt", el => el.click());
    
    // let test=await page.$("div.section-hotel-trip-type-summary");
    // console.log(test);
    // await page.waitForSelector("div.section-hotel-trip-type-summary");
    await page.waitForTimeout(5000);
    if(await page.$("div.section-hotel-trip-type-summary,[aria-label*='Affiner les avis'],[aria-label*='Refine reviews']")!=null){
    // let tagsarr = document.querySelector("div.section-hotel-trip-type-summary").innerText.split("\n");
    let tagsarr = await page.$eval("div.section-hotel-trip-type-summary,[aria-label*='Affiner les avis'],[aria-label*='Refine reviews']", el => el.innerText.split("\n"));
    // console.log("tagsarr \n",tagsarr);
    
    for(let i=0;i<tagsarr.length;i+2){
        let ay = tagsarr.splice(i,i+2);
    
        arr.push(ay);   
    }

    tags = Object.fromEntries(arr);
    // console.log("tags 0 \n",tags);
    }

    // await page.click("button.gm2-button-alt");
    // await page.waitForSelector("button.tuPVDR7ouq5__button");
    // let listRefine=await page.$$eval("button.tuPVDR7ouq5__button", options => options.map(option => {
    //     let refineList = option.innerText.split("\n");
    //     let refineObj = {name : refineList[0],number : (refineList[1] ? refineList[1] : "0")};
    //     return refineObj;
    //  }));
    // listRefine.pop()
    // refineReviews = {...listRefine};

    // Get refineReviews
    refineReviews = await page.evaluate(() => {
        try {
            let reviewTags = document.querySelector("div.section-hotel-trip-type-summary,[aria-label*='Affiner les avis'],[aria-label*='Refine reviews']");
            let refineReviews;
            let refineDomList = [...reviewTags.querySelectorAll("button[class*='button'")];
            let listRefine = refineDomList.map(option => {
                let refineList = option.innerText.split("\n");
                let refineObj = {name : refineList[0],number:(refineList[1] ? refineList[1] : "0")};
                return refineObj;
            });
            listRefine.pop()
            refineReviews = {...listRefine};
            return refineReviews;
        } catch (error) {
            return {}
        }
        
    });

    // Get stars per number of reviews <=> starsPerReviews
    let reviewsArray = await page.evaluate(() => {
        try {
            let reviewsDomList = [...document.querySelectorAll("tr[class*='histogram']")];
            let reviews = reviewsDomList.map(el => {
            let str =  el.getAttribute("aria-label");
            let list = str.split(", ");
            let obj = {[list[0]]:list[1].match(/(\d+,?)+/g)[0]};
            return obj;
        });
        return reviews;
        } catch (error) {
            return "";
        }
        
    });
    
    starsPerReviews = Object.assign({},...reviewsArray);

}
//************************************

    const {
        business_status,
        amentiesHotel,
        placeId,
        url: placeUrl,
        title: name,
        rating,
        reviewsNumber,
        city,
        country,
        category,
        stars,
        searchString,
        address,
        plusCode,
        website,
        phoneNumber,
        claimed,
        hotelsAds,
        selectorsType,
        html,
    } = detail;
    const result = {
        business_status,
        starsPerReviews : starsPerReviews || null,
        placeId,
        placeUrl,
        location,
        name,
        category: category || (stars ? "Hotel" : null),
        stars : stars || null,
        description : descriptionPlace || descriptionHotel || "",
        amenties : amentiesPlaceObj || amentiesHotel || null,
        pointsforts : pointsforts || null,
        rating: rating || null,
        // reviewsNumber: reviewsNumber || null,
        reviewsNumber: numberOfReviews || null,
        city: city || null,
        country,
        address: address || null,
        plusCode: plusCode || null,
        website: website || null,
        phoneNumber: phoneNumber || null,
        claimed,
        searchString,
        // reviewTags : tags || null,
        refineReviews : refineReviews || null ,
    };
    if (hotelsAds) {
        for (const [name, price] of Object.entries(hotelsAds)) {
            result[_.capitalize(name)] = price;
        }
    }
    result['#debug'] = {};
    result['#debug']['#selectorsType'] = selectorsType;
    result['#debug']['#html'] = html;
    return result;
};


const setupLanguageAndCurrency = async ({ browser, languageCode, currencyCountry }) => {
    // await browser.close();
    const page = (await browser.pages())[0];
    await page._client.send('Emulation.clearDeviceMetricsOverride');
    await page.goto(
        'https://www.google.com/preferences?prev=https%3A%2F%2Fwww.google.com%2Fmaps#location',
        { timeout: 60 * 1000 },
    );
    await page.reload();
    page.on('dialog', async (dialog) => {
        await dialog.accept();
    });
    await page.waitForSelector('[name="sig"]');
    const region = currencyCountry.toUpperCase();
    await page.waitForSelector('#regionanchormore');
    await page.click('#regionanchormore');
    await page.click(`[data-value="${region}"][role="radio"]`);


    await page.click('[id="langSecLink"] a');
    await page.waitForSelector('#langanchormore');
    await page.click('#langanchormore');
    await page.click(`#langtop [data-value="${languageCode}"][role="radio"]`);
    await page.click('#form-buttons > div.jfk-button-action');

    await page.waitForNavigation();

    if (await page.$('form#captcha-form')) {
        await browser.close();
        throw new Error('Couldn\'t save settings (language & region)');
    }
};

/**
 * Method to set up crawler to get all place details and save them to default dataset
 * @param {Object} params
 * @param params.requestQueue
 * @param params.input
 * @param params.languageCode
 * @param params.currencyCountry
 * @return {PuppeteerCrawler}
 */
const setUpCrawler = async ({ requestQueue, input, languageCode, currencyCountry }) => {
    const { proxyConfig } = input;
    const puppeteerPoolOptions = {
        maxOpenPagesPerInstance: 1,
    };
    if (proxyConfig && proxyConfig.useApifyProxy && proxyConfig.proxyUrls && proxyConfig.proxyUrls.length > 0) {
        puppeteerPoolOptions.proxyUrls = proxyConfig.proxyUrls;
    }
    fs.rmdirSync('/tmp/afp', { recursive: true });

    const crawlerOpts = {
        requestQueue,
        maxRequestRetries: MAX_PAGE_RETRIES, // Sometimes page can failed because of blocking proxy IP by Google
        retireInstanceAfterRequestCount: 100,
        handlePageTimeoutSecs: 30 * 60, // long timeout, because of long infinite scroll
        maxConcurrency: Apify.isAtHome() ? undefined : 1,
        puppeteerPoolOptions,
        launchPuppeteerFunction: async (options) => {
            const sessionId = Math.random();
            const chromeProfileDataDir = `/tmp/afp/cgpc-profile-${sessionId}`;
            log.info(`Chrome profile data dir: ${chromeProfileDataDir}`);
            fs.rmdirSync(chromeProfileDataDir, { recursive: true });

            if (proxyConfig && proxyConfig.useApifyProxy && !(proxyConfig.proxyUrls && proxyConfig.proxyUrls.length > 0)) {
                const proxyUrl = Apify.getApifyProxyUrl({
                    groups: proxyConfig.apifyProxyGroups,
                    country: proxyConfig.apifyProxyCountry,
                    session: sessionId,
                });
                const proxyInfo = {
                    proxyUrl,
                    ..._.pick(await getProxyInfo(proxyUrl), ['clientIp', 'countryCode']),
                };
                log.info('Constructed proxy:', proxyInfo);
                options.proxyUrl = proxyUrl;
            }
            if (!Apify.isAtHome()) {
                options.useChrome = true;
            }
            options.userDataDir = chromeProfileDataDir;
            options.defaultViewport = {
                width: 1366,
                height: 637,
                deviceScaleFactor: 1,
            };
            options.args = ['--disable-notifications',
                '--window-position=0,0',
                `--window-size=${1366},${768}`,
                // '--disk-cache-dir=/tmp/afp-cgpc',
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-infobars'];
            const browser = await Apify.launchPuppeteer(options);
            await setupLanguageAndCurrency({
                browser,
                languageCode,
                currencyCountry,
                chromeProfileDataDir,
            });
            return browser;
        },
    };
    return new Apify.PuppeteerCrawler({
        ...crawlerOpts,
        gotoFunction: async ({ request, page }) => {
            await page._client.send('Emulation.clearDeviceMetricsOverride');
            await blockRequests(page, {
                urlPatterns: ['/maps/vt/', '/earth/BulkMetadata/', 'googleusercontent.com'],
            });
            await page.goto(request.url, { timeout: 60 * 1000 });
        },
        handlePageFunction: async ({ request, page, puppeteerPool }) => {
            const { retryCount, url, userData, uniqueKey } = request;
            const { label, searchString } = userData;

            log.info(`Open ${url} with label: ${label}`);
            await injectJQuery(page);

            let error;
            try {
                // Check if Google shows captcha
                if (await page.$('form#captcha-form')) {
                    // console.log('******\nGoogle shows captcha. This browser will be retired.\n******');
                    userData.shouldRetireBrowser = true;
                    throw new Error('Google shows captcha!');
                }
                const lang = await page.evaluate(() => {
                    const htmlHtmlElement = document.querySelector('html');
                    return htmlHtmlElement.getAttribute('lang') || undefined;
                });
                if (!lang || !lang.includes(languageCode)) {
                    console.log(`******
Google shows the web page in a language different from allowed language ${languageCode} (found language: ${lang}).`
                        + ` This browser will be retired.
******`);
                    userData.shouldRetireBrowser = false;
                    throw new Error(`Google shows the web page in a language different from allowed language ${languageCode}!`);
                }
                if (label === 'startUrl') {
                    log.info(`Start enqueuing places details for search: ${searchString}`);
                    await enqueueAllPlaceDetails({
                        page,
                        requestQueue,
                        input,
                        request
                    });
                    log.info('Enqueuing places finished.');
                } else {
                    // Get data for place and save it to dataset
                    log.info(`Extracting details from place url ${page.url()}`);
                    const placeDetail = await extractPlaceDetail({
                        page,
                        requestQueue,
                        input,
                        request,
                    });
                    await Apify.pushData(placeDetail);
                    log.info(`Finished place url ${placeDetail.placeUrl}`);
                }
            } catch (err) {
                error = err;
            }
            if ((log.getLevel() === log.LEVELS.DEBUG && label === 'startUrl') || error) {
                const preKey = getValidKey({
                    str: uniqueKey + (retryCount === 0 ? '' : `_${retryCount}`),
                    replaceChar: '_',
                    length: 251,
                });
                await saveHTML(page, `${preKey}.html`);
                await saveScreenshot(page, `${preKey}.png`);
            }
            const { shouldRetireBrowser = false } = userData;

            if (error) {
                if (shouldRetireBrowser) {
                    // This issue can happen, mostly because proxy IP was blocked by google
                    // Let's refresh IP using browser refresh.
                    await puppeteerPool.retire(page.browser());
                }
                userData.shouldRetireBrowser = false;
                if (retryCount < MAX_PAGE_RETRIES && log.getLevel() !== log.LEVELS.DEBUG) {
                    // This fix to not show stack trace in log for retired requests, but we should handle this on SDK
                    error.stack = 'Stack trace omitted for retires requests. Set up debug mode to see it.';
                }
                throw error;
            }
        },
        handleFailedRequestFunction: async ({ request, error }) => {
            // This function called when crawling of a request failed too many time
            const defaultStore = await Apify.openKeyValueStore();
            await Apify.pushData({
                '#url': request.url,
                '#succeeded': false,
                '#errors': request.errorMessages,
                '#debugInfo': Apify.utils.createRequestDebugInfo(request),
                '#debugFiles': {
                    html: defaultStore.getPublicUrl(`${request.id}.html`),
                    screen: defaultStore.getPublicUrl(`${request.id}.png`),
                },
            });
            log.exception(error, `Page ${request.url} failed ${MAX_PAGE_RETRIES} times!`
             + ' It will not be retired. Check debug fields in the dataset to find the issue.');
        },
    });
};

module.exports = { setUpCrawler };
