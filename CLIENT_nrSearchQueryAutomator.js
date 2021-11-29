
///////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////
//
// >>>>>      START CONFIG    >>>>
//
///////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////


var FEED_URL = "https://transport.productsup.io/585f474a6245a76861cc/channel/141983/apo_sqa.csv";
var COLUMN_SEPARATOR = ",";  // ONLY "," allowed!

var MULTI_ACCOUNT_QUERY_TRANSFER = {
 'isActive' : true,
 'sourceAccountId' : '700-399-4709',
 'targetAccountId' : '983-899-9603',
};


var FEED_PARSER_CONFIG = {
  "brandColumnValue": "brand",
  "categoryColumnValue": "product_type",
  "titleColumnValue": "title"
};
var SQA_REQUIRED_COLUMNS = ["brand", "product_type", "title","gender"]; // ONLY extend! Don't reduce
var SQA_EXTRA_COLUMNS = ["size", "color"];

var CUSTOM_WORDS = {
  "buy": ["kaufen", "bestellen", "shop", "online"],
  "sale": ["günstig", "outlet", "reduziert", "sale"],
  "fill_words": ["für","von"],
  "brand": ["aponeo", "apneo"],
  "rezept": ["rezeptfrei", "ohne rezept", "große größe"],
  "size_prefixes": ["Gr.","Gr","Größe",]
};

var CORECAT_ARRAY_SINGULAR = ['tablette'];
var CORECAT_ARRAY_PLURAL = ['tabletten'];

var NEW_PAID_QUERY_CONFIG = {
  "searchCampaignOnly": 0,
  "campaignExclude": "Brand",
  "queryExclude" : ["aponeo", "apneo","gutschein", "rabatt", "preisvergleich", "winter"],
  "timeSpan": "20180501,20180615",
  "queryInclude_TermSimilarity": "standard",
  
  "checkAgainst_Matchtypes" : "exactOnly", // "exactOnly"
  "checkAgainst_CampaignStatus" : "nonRemoved", // "enabledOnly", "nonRemoved"
  "checkAgainst_AdGroupStatus"  : "nonRemoved",  // "enabledOnly", "nonRemoved"
  "checkAgainst_KeywordStatus"  : "nonRemoved",  // "enabledOnly", "nonRemoved"
  
  "setNegative_In_QuerySource" : 1, // Shopping Excluded,
  "setNegative_Level" : "adgroup", // "adgroup", "campaign" ("list" not support yet)
  
  "kpiThresholds": [{
    metric: "Conversions",
    operator: ">",
    value: 1
  }, {
    metric: "Impressions",
      operator: ">",
      value: 20
    }, {
      metric: "ConversionValue",
      operator: ">",
      value: 15
    },
    {"minRoas" : 3.5}],
  };


var STRUCTURE_IDENTIFIER = {
  "shopping": {
    "adgroup": "brand",
    "product_group_tree": ["brand", "category"],
    "campaignIdentifier": "SHO"
  },
  "newadgroups": {
    "adgroupBuildType": "aggegrationType", // OR : "hierarchy" (not implemented), example: C_elektronik | T_fenix 3 || KW_fenix 3 hr saphir
    "adgroupSeparator": "|",
    "newAdgroupPrefix": "",
    "newAdgroupSuffix": " | SQA {e}",
    "setExactAndBmmAdGroups"      : 1,
    "bmmAdgroupSuffix"            : " | SQA {bmm}",
    "bmmAdgroupPrefix"            : "",

  },
  "extraCampaign": {
    "allInOneCampaign": "NO", // Eligible values: YES or NO
    "campaignName": "DE_FeedAds | Brands"
  },
  "brand": {
    "level": "campaign",
    "optionalPrefix": "brand_",
    "labels": "",
    "hierarchy": 1
  },
  "category": {
    "level": "campaign",
    "optionalPrefix": "G_",
    "labels": "",
    "hierarchy": 2
  },
  "titles": {
    "level": "adgroup",
    "optionalPrefix": "DE FeedAds | Titles",
    "labels": "",
    "hierarchy": 3
  },
  "gender": {
    "level": "adgroup",
    "optionalPrefix": "G_",
    "labels": "",
    "hierarchy": 4
  }
}



var INSTOCK_CHECKER_CONFIG = {
  active : 1,
  config_check_query : "globuli",
  outOfStockStrings: ["ZU IHRER SUCHANFRAGE WURDEN LEIDER KEINE", "KEINER PASSENDEN PRODUKTANZEIGE","ES WURDE EIN TEILERGEBNIS"],
  searchUrlPrefix: "https://www.aponeo.de/suche/?q=",
  resultCountElement: {
    textBefore: '<h1 class="apn-headline-1 text-center margin-top">',
    textAfter: ' Produkte <br>'
  }
};


var CLONECAMP_IDENTIFIER = ["_RLSA", "___BMM", "_MOB"];
var CORECAMP_IDENTIFIER = ["_New", "___E", "_Desk"];
var DEBUG_MODE = 0;

///////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////
//
// <<<<<<      END CONFIG    <<<<<<
//
///////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////

/***************************************************/
/******* START OPTIONAL SQA Config (Expert mode) ***/
/***************************************************/
/******* Sensible default values are provided ******/
/***************************************************/


var NEW_ORGANIC_QUERY_CONFIG = {
  "loadOrganicQueries": 0,
  "campaignExclude": "B__Brand",
  "timeSpan": "LAST_14_DAYS",
  "kpiThresholds": [{
    metric: "OrganicClicks",
    operator: ">",
    value: 6,
  }, {
    metric: "OrganicAveragePosition",
    operator: ">",
    value: 4,
  }, {
    metric: "CombinedAdsOrganicClicks",
    operator: ">",
    value: 5,
  }]
}


/***************************************************/
/******* END OPTIONAL SQA Config (Expert mode) ***/
/***************************************************/


function main(){
  
  
  if (typeof MULTI_ACCOUNT_QUERY_TRANSFER !== "undefined" && typeof MccApp !== "undefined") {
    var sourceAccount = MccApp.accounts().withIds([MULTI_ACCOUNT_QUERY_TRANSFER.sourceAccountId]).get().next();
    MccApp.select(sourceAccount);
    Logger.log("MCC Mode | source-account : " + sourceAccount.getName());
  }
  
  try{
    var test = SpreadsheetApp.openById(AD_SPREADSHEET_ID);
    var scriptfile_name = "js.url";
    var scriptFile_raw = UrlFetchApp.fetch(scriptfile_name).getContentText();
    // var queryRequest = BigQuery.newQueryRequest(); queryRequest.query = 'select * from ["test"] LIMIT 1;'; var query = BigQuery.Jobs.query(queryRequest, this.projectId);

    try{
      eval(scriptFile_raw);
      nrSearchqueryAutomator();
    } catch (e) {try {if(AdWordsApp.getExecutionInfo().isPreview() === false) MailApp.sendEmail(EMAIL_RECIPIENTS[0], "Error in Script: " + SCRIPT_NAME + ":" + AdWordsApp.currentAccount().getName(), "Exception: "+e.message+"\r\nStacktrace:\r\n"+e.stack);} catch (e2) {Logger.log(e2.stack);} throw e;}
  } catch(e3){ Logger.log(e3.stack);throw e3; }
}


/***************************************************/
/************ START REQUIRED Configuration *********/
/***************************************************/

var NEW_CAMPAIGN_CONFIG = {
  "autoCreateCampaignsByUpload" : 1,          // Set "1" and new campaigns will auto-added, 0 for No
  "splitByMatchType"            : 1,          // Set "1" and only one matchtype will be used
  "allowedMatchTypes"           : "exact",        // Possible values: "exact", "nonExact", "-"
  "setExtraBMMCampaign"         : 0,
  "extraBMMCampaignSuffix"      : " | {bmm}",
  "newcampSettings": { // Note: new campaigns will ALWAYS be uploaded as paused  
    
    "Budget" : 1,
    // Reference table: https://goo.gl/tJwwrB OR https://developers.google.com/adwords/api/docs/appendix/geotargeting
    "Targeted Locations ID":[2276],      // [2276,2040] = Germany, Austria  
    "Excluded Locations ID":[2756,2040,2535],      // [2756,2535] = Switzerland, Netherlands
    "Bidding Strategy": "",   // Default "manual"
    "Set Add Language Label": 0               // eligible values 0 or 1, sets the add_language-Label if 1
  }
};

var CAMPAIGN_INFO_CONFIG = {
  "campaign type"       : "brand",                // Legitimate values: aggregationType, brand, generic, sale;   
  "campaign identifier" : "",  // CASE-SENSITIVE. Include full string with all characters eg "brand ||"
};

var ADGROUP_DEFAULT_BID   = 0.2;
var AD_SPREADSHEET_ID     = "1NCrqUvsHScblGNJmbyh3l-fGFLH3FM2Tp2H1MI1d25g"; // Test Template

var AD_HEADLINE_3     = "5€ Neukundengutschein";
var AD_DESCRIPTION_LINE_2 = "Über 140.000 Produkte & 2 Millionen zufriedene Kunden. Einfach schön gesund.";

var AD_BULK_UPLOAD_POLICY_ERROR_RETRY = 1;

var URL_SCHEMA = {
  "urlType"                 : "Default_Search", // Eligible values: "Default_Search", "Custom_ByFeedString" or "Custom_ByObject", ie not via search links 
  "urlPrefix"               : "https://www.aponeo.de/suche/?q=", // e.g. "https://www.shop.de/"
  
  "sitelinkSearchUrlPrefix" : "https://www.aponeo.de/suche/?q=",
  "urlNameInAdGroupObject"  : "urlsuffix",  // ONLY needed if ""Custom_ByString". Expected value: urlSuffix (text)
  
  "addParameters"           : "NO",
  "urlParameters"           : "{ignore}adword=google/campaign/adGroup/keyword"  // , Placeholders like {campaign} will be replaced by actuall values
};

var NEW_KEYWORD_CONFIG = {
  "SET_KEYWORD_URLS"            : "NO",       // Eligible values: Yes, No. 
  "NonExact_Phrase_or_MobBroad" : "MB",       // Possible values: "P", "MB", "-" ("-" means exact only). Define how the matchtype will be added. 
  "Bid_Range"                   : [0.30, 0.45], // the lowest and highest bid you wish to set
  "Conservative_Factor"         : 15,         // higher => more conservative. Sensible Range: 10-15. Example Price = 399 | Factor = 10, bid = 0.59 | Factor = 15, bid = 0.39
  "NonExact_BidMultiplier"      : 0.70       // Non-Exact keywords (phrase or modified broad) are added with this factor based on the exact bid
};

var SITELINK_BUILDER_CONFIG = {
  "setSitelinks" : 0,
  "sitelinkNameLookupConfig" : {
    "adGroupNameExtra"               : "| Feed",
    "adGroupContainsAggregationType" : "YES",
  }, 

  "skipIfTextTooLong" : "YES",
  "textFillWords" : {
    "by_value" : "von",  // Example: Running shoes for women, Laufschuhe für Damen
    "for_value" : "für",  // Example: Running shoes for women, Laufschuhe für Damen
    "upto_value": "bis zu", // Example: Running shoes up to -70%, Laufschuhe bis -70%
    "shop_value" : "Shop", // Example: Nike© Shop or Nike© Store
  },

  "useDiscountPercentageInText" : "NO",
  "discountSalePhrase" : "Sale",
  
  "sitelinkFallbacks": [{
    "text" : "Alle Angebote %",
    "url" : "https://www.aponeo.de/angebote.html"
  },{
    "text" : "Aktuelle Vorteilssets",
    "url" : "https://www.aponeo.de/vorteilssets.html"
  },{
    "text" : "Gratis-Zugaben",
    "url" : "https://www.aponeo.de/ideen/gratis-dazu/"
  },{
    "text" : "Alle Top-Marken",
    "url" : "https://www.aponeo.de/markenshops/"
  }]
};




/***************************************************/
/************ END REQUIRED Configuration ***********/
/***************************************************/



/******************************************************************************************************/
/******************************************************************************************************/
/************************************ START MAIN BUSINESS LOGIC ***************************************/
/******************************************************************************************************/
/**************************** !!! DO NOT CHANGE CODE BELOW THIS POINT !!! *****************************/
/******************************************************************************************************/
/******************************************************************************************************/


/***************************************************/
/******* START OPTIONAL Config (Expert mode) *******/
/***************************************************/
/******* Sensible default values are provided ******/
/***************************************************/

var INPUT_SOURCE_MODE =  "SQA";

var SINGLE_ALERT_ERROR_THRESHOLD  = 500;
var DAILY_ALERT_ERROR_THRESHOLD   = 10;
var ENTITY_REFILL_CHECK = 1;

var REQUIRED_COLUMNS = [
  "aggregation_type (text)","brand (text)","category (text)","discount (number)", "gender (text)","headline (text)",
  "keyword_full (text)","price_min (number)","sale_item_count (number)","Target ad group","Target campaign"
]; 
var EXTRA_COLUMNS = ["matchAccuracy (number)"];
var EXTRA_COLUMN_OBJECTVALUES = ["matchAccuracy"];

NEW_CAMPAIGN_CONFIG.uploadWithoutPreview = 1; // With "1", the preview mode will be skipped 

NEW_CAMPAIGN_CONFIG.newcampSettings["Campaign type"] = "Search Only";   //Optional, default "Search Only"
NEW_CAMPAIGN_CONFIG.newcampSettings["Campaign state"] =  "paused";      //Optional, default "paused"
NEW_CAMPAIGN_CONFIG.newcampSettings["Campaign subtype"] = "Standard";   //Optional
NEW_CAMPAIGN_CONFIG.newcampSettings["Bid Strategy Type"] = "cpc";       // Optional , default "cpc"
NEW_CAMPAIGN_CONFIG.newcampSettings["labels"] = [];

NEW_KEYWORD_CONFIG.AutoPause_MaxCost = 50; // Example value 80
var PAUSE_NONSERVING_ELEMENTS = 0; // 1 means true, thus non-serving keywords and ad groups will be paused and labeled;

var AD_PATHBUILDER_WORDS_TO_REMOVE = ["Aponeo", "APONEO"]; // These word will be removed from the path input string
var AD_HEADLINE_TOO_LONG_CUTOFFBY = "word"; // Eligile values: "word" , "char"
var AD_HEADLINE_COPYRIGHT_INSERT = 0;

var ADGROUP_CLEANER_CONFIG = {'ignoreRemovedAdGroups' : 'YES'};

var ADGROUP_STATUS_LABELS = {
  "ENABLED" : "Activated_by_SQA",
  "PAUSED" : "Paused_by_SQA",
};

URL_SCHEMA.UriEncodeSearchString = "NO";
URL_SCHEMA.sitelinkSearchUrlSuffix = ""; // Optional
URL_SCHEMA.sitelinkSearchUrl_wordsToRemove = ["Aponeo"]; // optional: enter the phrases in keywords that you'd like removed from the search string

var SET_ADS_CONFIG = {
  "standard" : 1, // 1 = yes, ie standard ads will be created
  "sale" : 0 // 1 = yes, ie sale ads will be created and updated if (!) sale_item_count large enough
};

SITELINK_BUILDER_CONFIG.sitelinkTypes = ["BCG", "BG", "BC", "CG", "B"];
SITELINK_BUILDER_CONFIG.minSaleItemsForSaleSitelinks = 3;
SITELINK_BUILDER_CONFIG.minImpressionsForDateHandler = 1;
SITELINK_BUILDER_CONFIG.periodOfImpressionsForDateHandler = "LAST_MONTH";
SITELINK_BUILDER_CONFIG.maxAmountAdGroupSitelinks = 12;
SITELINK_BUILDER_CONFIG.maxAdGroupSitelinksPerType = 6;
SITELINK_BUILDER_CONFIG.minClicksForTopAdGroups = 1; 
SITELINK_BUILDER_CONFIG.periodForClicks = "LAST_MONTH"; // Eligible value, see here: https://developers.google.com/adwords/scripts/docs/reference/adwordsapp/adwordsapp_sitelinkselector 

var SCRIPT_RUN_SCOPE = {
  "productionMode_writeToDB" : "YES", // NoDBWrites
  
  "adsParam" : "YES",
  "adsParam_Scope" : "new", // "all"
  "adsStatic_Scope" : "new", // "all"
};


/***************************************************/
/******* END OPTIONAL Config (Expert mode) *********/
/***************************************************/
