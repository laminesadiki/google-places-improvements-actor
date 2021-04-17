// Reviews Stars with partitions 

let reviewsArray = [...document.querySelectorAll("tr.jqnFjrOWMVU__histogram")];
let reviews = reviewsArray.map(el => {
   let str =  el.getAttribute("aria-label");
   let list = str.split(",");
   let obj = {[list[0]]:list[1]};
   return obj;
})

let ObjReviews = Object.assign({},...reviews);

console.log(ObjReviews);

// Get Pointsforts from Browser
let pointsFortsDOM = document.querySelector("div.uDxUUUCO4ji__container").innerText.trim().split("\n");

