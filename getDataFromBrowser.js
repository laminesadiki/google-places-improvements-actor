// Reviews Stars with partitions 

let reviewsArray = [...document.querySelectorAll("tr.jqnFjrOWMVU__histogram")];
let reviews = reviewsArray.map(el => {
   let str =  el.getAttribute("aria-label");
   let list = str.split(",");
   let obj = {[list[0]]:list[1].match(/(\d+)/g)[0]};
   return obj;
})

let ObjReviews = Object.assign({},...reviews);

console.log(ObjReviews);

// Get Pointsforts from Browser
let pointsFortsDOM = document.querySelector("div.uDxUUUCO4ji__container").innerText.trim().split("\n");


// Get reviewsNumber
let reviewsNumber = document.querySelector('button[jsaction="pane.rating.moreReviews"]').innerText.match(/(\d+)/g)[0];

// Get stars
let stars = [...document.querySelectorAll('span[jsaction="pane.rating.moreReviews"]')][1].innerText.trim().match(/(\d+)/g)[0];

// Get RefineReviews
let refineReviews;
let refineDomList = [...document.querySelectorAll("button.tuPVDR7ouq5__button")];
let listRefine = refineDomList.map(option => {
   let refineList = option.innerText.split("\n");
   let refineObj = {name : refineList[0],number:refineList[1]};
   return refineObj;});
listRefine.pop()
refineReviews = {...listRefine};
console.log(refineReviews);
