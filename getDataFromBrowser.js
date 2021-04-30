// Reviews Stars with partitions 

let reviewsArrayOlder = [...document.querySelectorAll("tr.jqnFjrOWMVU__histogram")];
let reviewsArray = [...document.querySelectorAll("tr[class*='histogram']")];
let reviews = reviewsArray.map(el => {
   let str =  el.getAttribute("aria-label");
   let list = str.split(",");
   let obj = {[list[0]]:list[1].match(/(\d+)/g)[0]};
   return obj;
})

let ObjReviews = Object.assign({},...reviews);

console.log(ObjReviews);

// Get reviewTags
let reviewTags = document.querySelectorAll("div.section-hotel-trip-type-summary,[aria-label*='Affiner les avis'],[aria-label*='Refine reviews']");




// Get Pointsforts from Browser
let pointsFortsDOM = document.querySelector("div.uDxUUUCO4ji__container").innerText.trim().split("\n");


// Get reviewsNumber
let reviewsNumber = document.querySelector('button[jsaction="pane.rating.moreReviews"]').innerText.match(/(\d+)/g)[0];

// Get stars for Hotel
let stars = [...document.querySelectorAll('span[jsaction="pane.rating.moreReviews"]')][1].innerText.trim().match(/(\d+)/g)[0];

//Get Rating

let older = document.querySelectorAll('span.fFNwM35iXVH__section-star-display'); 
let updated = document.querySelectorAll('[class*=section-star-display');

// Get RefineReviews
let reviewTags = document.querySelector("div.section-hotel-trip-type-summary,[aria-label*='Affiner les avis'],[aria-label*='Refine reviews']");
let refineReviews;
let refineDomList = [...reviewTags.querySelectorAll("button[class*='button'")];
let listRefine = refineDomList.map(option => {
   let refineList = option.innerText.split("\n");
   let refineObj = {name : refineList[0],number:(refineList[1] ? refineList[1] : "0")};
   return refineObj;});
listRefine.pop()
refineReviews = {...listRefine};
console.log(refineReviews);


// Get hotelsAds
document.querySelector("button.section-hotel-prices-more-rates-container").click();
let container = document.querySelector("div.section-hotel-prices-booking-container");
let elementsDOM = [...container.querySelectorAll("div[class*='partner-container']")];
let hotelsAdsList = elementsDOM.map(el => {
   let name = el.querySelector("span[class*='partner-name']").innerText;
   let price = el.querySelector("button[class*='display-price-button']").innerText;
   return {[name]:price}
});
let hotelsAdsObj = Object.assign({},...hotelsAdsList);
console.log(hotelsAdsObj);

// Get Business Status
let business_status_older = document.querySelectorAll("span.cX2WmPgCkHi__section-info-hour-text");
let business_status_newer = document.querySelectorAll("span[class*='section-info-hour-text'");

// Get description and details
let nextBtn = document.querySelector("button[class*='section-editorial']");
let amentiesPlace = document.querySelectorAll(".section-attribute-group");
let content = document.querySelectorAll("[class*='section-attribute-group-container'] > li");

//Test pushing







