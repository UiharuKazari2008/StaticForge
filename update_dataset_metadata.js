const fs = require('fs');
const path = require('path');

// Metadata configuration for top-level categories
const categoryMetadata = {
  "attire": {
    prettyName: "Clothing & Attire",
    icon: "fa-shirt"
  },
  "body": {
    prettyName: "Body & Anatomy",
    icon: "fa-person"
  },
  "creatures": {
    prettyName: "Animals & Creatures",
    icon: "fa-paw"
  },
  "games": {
    prettyName: "Games & Entertainment",
    icon: "fa-gamepad"
  },
  "image": {
    prettyName: "Image & Composition",
    icon: "fa-image"
  },
  "more": {
    prettyName: "Miscellaneous",
    icon: "fa-ellipsis"
  },
  "objects": {
    prettyName: "Objects & Items",
    icon: "fa-cube"
  },
  "plants": {
    prettyName: "Plants & Nature",
    icon: "fa-seedling"
  },
  "rworld": {
    prettyName: "Real World",
    icon: "fa-globe"
  },
  "sex": {
    prettyName: "Adult Content",
    icon: "fa-heart"
  }
};

// Subcategory metadata for better organization
const subcategoryMetadata = {
  // Attire subcategories
  "sexual": { prettyName: "Intimate Wear", icon: "fa-heart" },
  "bra": { prettyName: "Bras", icon: "fa-female" },
  "panties": { prettyName: "Underwear", icon: "fa-female" },
  "nude": { prettyName: "Nude & Partial", icon: "fa-user" },
  "attire": { prettyName: "Regular Clothing", icon: "fa-tshirt" },
  
  // Body subcategories
  "bodyparts": { prettyName: "Body Parts", icon: "fa-user" },
  "bodytype": { prettyName: "Body Types", icon: "fa-users" },
  "bodymod": { prettyName: "Body Modifications", icon: "fa-tattoo" },
  
  // Creatures subcategories
  "animals": { prettyName: "Animals", icon: "fa-paw" },
  "mythical": { prettyName: "Mythical Creatures", icon: "fa-dragon" },
  
  // Games subcategories
  "videogames": { prettyName: "Video Games", icon: "fa-gamepad" },
  "boardgames": { prettyName: "Board Games", icon: "fa-chess" },
  "sports": { prettyName: "Sports", icon: "fa-futbol" },
  
  // Image subcategories
  "alicense": { prettyName: "Alternative Versions", icon: "fa-magic" },
  "composition": { prettyName: "Composition", icon: "fa-camera" },
  "quality": { prettyName: "Image Quality", icon: "fa-star" },
  "style": { prettyName: "Art Styles", icon: "fa-palette" },
  
  // More subcategories
  "family": { prettyName: "Family", icon: "fa-users" },
  "food": { prettyName: "Food & Drinks", icon: "fa-utensils" },
  "locations": { prettyName: "Locations", icon: "fa-map-marker" },
  "activities": { prettyName: "Activities", icon: "fa-running" },
  
  // Objects subcategories
  "weapons": { prettyName: "Weapons", icon: "fa-sword" },
  "furniture": { prettyName: "Furniture", icon: "fa-couch" },
  "electronics": { prettyName: "Electronics", icon: "fa-laptop" },
  "vehicles": { prettyName: "Vehicles", icon: "fa-car" },
  
  // Plants subcategories
  "trees": { prettyName: "Trees", icon: "fa-tree" },
  "flowers": { prettyName: "Flowers", icon: "fa-flower" },
  "herbs": { prettyName: "Herbs", icon: "fa-leaf" },
  
  // Real World subcategories
  "celebrations": { prettyName: "Celebrations", icon: "fa-birthday-cake" },
  "culture": { prettyName: "Culture", icon: "fa-flag" },
  "places": { prettyName: "Places", icon: "fa-building" },
  
  // Sex subcategories
  "positions": { prettyName: "Positions", icon: "fa-heart" },
  "toys": { prettyName: "Toys", icon: "fa-gift" },
  "fetishes": { prettyName: "Fetishes", icon: "fa-heart" }
};

// Array name mappings for better readability
const arrayNameMappings = {
  // Attire arrays
  "lingerie": "Lingerie Items",
  "bdsm": "BDSM Gear",
  "exposure": "Revealing Items",
  "misc": "Miscellaneous",
  "models": "Bra Types",
  "colors": "Color Variants",
  "patterns&prints": "Patterns & Prints",
  "main": "Main Items",
  "appearance/colors": "Color Variants",
  "appearance/patterns&prints": "Patterns & Prints",
  "appearance/materials": "Materials",
  "appearance/incomplete": "Incomplete Items",
  "appearance/size": "Size Variants",
  "appearance/other": "Other Styles",
  "appearance/details": "Details & Features",
  "interaction/clothes": "Clothing Interactions",
  "interaction/body": "Body Interactions",
  "interaction/other": "Other Interactions",
  "head": "Head Accessories",
  "top": "Upper Body",
  "bottom": "Lower Body",
  "footwear": "Shoes & Boots",
  "accessories": "Accessories",
  "outfits": "Complete Outfits",
  
  // Body arrays
  "head": "Head Parts",
  "uppertorso": "Upper Torso",
  "lowertorso": "Lower Torso",
  "appendages": "Limbs",
  "types": "Body Types",
  "modifications": "Modifications",
  
  // Creatures arrays
  "categories": "Animal Categories",
  "types/insect": "Insects",
  "types/cat": "Felines",
  "types/dog": "Canines",
  "types/reptile|amphibian": "Reptiles & Amphibians",
  "types/fish": "Fish",
  "types/bird": "Birds",
  "types/mammal": "Mammals",
  "mythical": "Mythical Beings",
  
  // Games arrays
  "genres": "Game Genres",
  "platforms": "Gaming Platforms",
  "characters": "Game Characters",
  "equipment": "Sports Equipment",
  "teams": "Sports Teams",
  
  // Image arrays
  "major": "Major Alterations",
  "attire": "Costume Changes",
  "bodyparts": "Body Changes",
  "equipment": "Equipment Changes",
  "hair": "Hair Changes",
  "eyes": "Eye Changes",
  "personalities": "Personality Changes",
  "colors": "Color Changes",
  "age": "Age Changes",
  "other": "Other Changes",
  "viewangle": "View Angles",
  "perspective": "Perspective",
  "framing": "Framing",
  "lighting": "Lighting",
  "effects": "Visual Effects",
  "artstyles": "Art Styles",
  "mediums": "Art Mediums",
  "techniques": "Art Techniques",
  
  // More arrays
  "terms": "Family Terms",
  "fruits": "Fruits",
  "vegetables": "Vegetables",
  "meats": "Meats",
  "drinks": "Beverages",
  "desserts": "Desserts",
  "dishes": "Dishes",
  "indoor": "Indoor Locations",
  "outdoor": "Outdoor Locations",
  "fantasy": "Fantasy Locations",
  "actions": "Actions",
  "emotions": "Emotions",
  "poses": "Poses",
  
  // Objects arrays
  "swords": "Swords",
  "guns": "Firearms",
  "bows": "Bows & Arrows",
  "magical": "Magical Weapons",
  "chairs": "Chairs",
  "tables": "Tables",
  "beds": "Beds",
  "computers": "Computers",
  "phones": "Phones",
  "cameras": "Cameras",
  "cars": "Cars",
  "motorcycles": "Motorcycles",
  "aircraft": "Aircraft",
  "boats": "Boats",
  
  // Plants arrays
  "deciduous": "Deciduous Trees",
  "evergreen": "Evergreen Trees",
  "wildflowers": "Wildflowers",
  "garden": "Garden Flowers",
  "medicinal": "Medicinal Herbs",
  "culinary": "Culinary Herbs",
  
  // Real World arrays
  "events": "Events",
  "newyear": "New Year",
  "cny": "Chinese New Year",
  "setsubun": "Setsubun",
  "valentines": "Valentine's Day",
  "hinamatsuri": "Hinamatsuri",
  "childrensday": "Children's Day",
  "summerfestival": "Summer Festival",
  "midautumn": "Mid-Autumn",
  "halloween": "Halloween",
  "christmas": "Christmas",
  "others": "Other Celebrations",
  "traditions": "Traditions",
  "customs": "Customs",
  "cities": "Cities",
  "landmarks": "Landmarks",
  "buildings": "Buildings",
  
  // Sex arrays
  "basic": "Basic Positions",
  "advanced": "Advanced Positions",
  "group": "Group Activities",
  "vibrators": "Vibrators",
  "dildos": "Dildos",
  "restraints": "Restraints",
  "clothing": "Sexy Clothing",
  "bodyparts": "Body Parts",
  "scenarios": "Scenarios"
};

function addMetadataToObject(obj, path = []) {
  const result = {};
  
  for (const [key, value] of Object.entries(obj)) {
    if (Array.isArray(value)) {
      // This is a final array of tags
      result[key] = value;
    } else if (typeof value === 'object' && value !== null) {
      // This is a nested object (category or subcategory)
      result[key] = addMetadataToObject(value, [...path, key]);
    }
  }
  
  // Add metadata if this is a top-level category or subcategory
  if (path.length === 0) {
    // Top-level category - add metadata to each top-level key
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'object' && !Array.isArray(value)) {
        const metadata = categoryMetadata[key];
        if (metadata) {
          result[key]._metadata = {
            prettyName: metadata.prettyName,
            icon: metadata.icon,
            arrayNames: {}
          };
          
          // Add array names for direct arrays under this category
          for (const [arrayKey, arrayValue] of Object.entries(value)) {
            if (Array.isArray(arrayValue) && arrayNameMappings[arrayKey]) {
              result[key]._metadata.arrayNames[arrayKey] = arrayNameMappings[arrayKey];
            }
          }
        }
      }
    }
  } else if (path.length === 1) {
    // Subcategory
    const subcategoryKey = path[0];
    const metadata = subcategoryMetadata[subcategoryKey];
    if (metadata) {
      result._metadata = {
        prettyName: metadata.prettyName,
        icon: metadata.icon,
        arrayNames: {}
      };
      
      // Add array names for arrays under this subcategory
      for (const [key, value] of Object.entries(obj)) {
        if (Array.isArray(value) && arrayNameMappings[key]) {
          result._metadata.arrayNames[key] = arrayNameMappings[key];
        }
      }
    }
  } else if (path.length >= 2) {
    // Deeper nested category - add array names if there are arrays
    const hasArrays = Object.values(obj).some(v => Array.isArray(v));
    if (hasArrays) {
      result._metadata = {
        arrayNames: {}
      };
      
      for (const [key, value] of Object.entries(obj)) {
        if (Array.isArray(value) && arrayNameMappings[key]) {
          result._metadata.arrayNames[key] = arrayNameMappings[key];
        }
      }
    }
  }
  
  return result;
}

function updateDatasetTagGroups() {
  try {
    console.log('Reading dataset tag groups file...');
    const filePath = path.join(__dirname, 'dataset_tag_groups.json');
    const data = fs.readFileSync(filePath, 'utf8');
    const datasetGroups = JSON.parse(data);
    
    console.log('Adding metadata to dataset groups...');
    const updatedGroups = addMetadataToObject(datasetGroups);
    
    console.log('Writing updated dataset groups...');
    const outputPath = path.join(__dirname, 'dataset_tag_groups_updated.json');
    fs.writeFileSync(outputPath, JSON.stringify(updatedGroups, null, 2), 'utf8');
    
    console.log(`✅ Successfully updated dataset tag groups with metadata!`);
    console.log(`📁 Output file: ${outputPath}`);
    console.log(`📊 Added metadata for ${Object.keys(categoryMetadata).length} top-level categories`);
    console.log(`🔧 Added metadata for ${Object.keys(subcategoryMetadata).length} subcategories`);
    console.log(`🏷️  Added array names for ${Object.keys(arrayNameMappings).length} arrays`);
    
  } catch (error) {
    console.error('❌ Error updating dataset tag groups:', error.message);
    process.exit(1);
  }
}

// Run the update
updateDatasetTagGroups(); 