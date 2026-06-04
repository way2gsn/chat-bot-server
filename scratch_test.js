const cat = require("./lib/catalog");
console.log("Keys in catalog module:", Object.keys(cat));
console.log("Is products defined?:", !!cat.products);
console.log("Products count:", cat.products ? cat.products.length : "N/A");
