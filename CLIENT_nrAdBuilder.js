/**
* nrAdBuilder for Feedbased Campaigns
* Version: 2.7
* @author: Christopher Gutknecht
* norisk GmbH
* cgutknecht@noriskshop.de
*
*/

/******************* CREDENTIALS ******************/
var API_KEY = "XXXXX";
var LICENSED_VERSION = "SOME_VERSION";



/***************************************************/
/************ START REQUIRED Configuration *********/
/***************************************************/


var SCRIPT_NAME       = "nrFeedCampaigns_B4F_2.1.0_Brands";  // This name will be shown in emails
var EMAIL_RECIPIENTS  = ["cgutknecht@noriskshop.de"];        // Add multiple emails with ["email1","email2"]

var NEW_CAMPAIGN_CONFIG = {
  "autoCreateCampaignsByUpload" : 1,          // Set "1" and new campaigns will auto-added, 0 for No
  "splitByMatchType"            : 1,          // Set "1" and only one matchtype will be used
  "allowedMatchTypes"           : "all" ,     // Possible values: "all" (exact + nonExact), "exact", "nonExact"

  "newcampSettings": {                        // Note: new campaigns will ALWAYS be uploaded as paused  
    "Budget" : 1,
    // Reference table: https://goo.gl/tJwwrB OR https://developers.google.com/adwords/api/docs/appendix/geotargeting
    "Targeted Locations ID":[2276,2040],      // [2276,2040] = Germany, Austria  
    "Excluded Locations ID":[2756],      // [2756,2535] = Switzerland, Netherlands
    "Negative Lists" : ["Liste1", "Liste2"],    // See list shared negative list names. These will be associated with your campaign
    "Mobile Bid Modifier": 0.75, // = -25% 
    "Tablet Bid Modifier": 0.90, // = -10% 
    "Bidding Strategy": "",   // Default "manual"
    "Set Add Language Label": 0               // eligible values 0 or 1, sets the add_language-Label if 1
  }
};

var CAMPAIGN_INFO_CONFIG = {
  "campaign type"       : "brand",                // Legitimate values: aggregationType, brand, generic, sale;   
  "campaign identifier" : "",  // CASE-SENSITIVE. Include full string with all characters eg "brand ||"
};

var FEED_URL              = "http://transport.productsup.io/95e5d287f1824d4cb0ba/channel/60082/b4f_adw_export_non-sale_bmm.csv"; //URL of your business data feed.
var COLUMN_SEPARATOR      = ",";

var ADGROUP_DEFAULT_BID   = 0.3;
var AD_SPREADSHEET_ID     = "1J2myXfHv9cT4O3E1LqsqAYq2u6UtrzbPbZcotk-DSQU";

var URL_SCHEMA = {
  "urlType"                 : "Default_Search", // Eligible values: "Default_Search", "Custom_ByFeedString" or "Custom_ByObject", ie not via search links
  "urlPrefix"               : "https://www.shop.de/outlet/?s=", // e.g. "https://www.shop.de/"

  "sitelinkSearchUrlPrefix" : "https://www.shop.de/outlet/?s=",
  "urlNameInAdGroupObject"  : "urlsuffix",  // ONLY needed if ""Custom_ByFeedString". Expected value: urlsuffix

  "addParameters"           : "YES",
  "urlParameters"           : "adword=google/campaign/adGroup/keyword"  // , Placeholders like campaign will be replaced by actuall values
};

var NEW_KEYWORD_CONFIG = {
  "SET_KEYWORD_URLS"            : "NO",       // Eligible values: Yes, No. 
  "NonExact_Phrase_or_MobBroad" : "MB",       // Possible values: "P", "MB", "-" ("-" means exact only). Define how the matchtype will be added. 
  "Bid_Range"                   : [0.1, 0.7], // the lowest and highest bid you wish to set
  "Conservative_Factor"         : 15,         // higher => more conservative. Sensible Range: 10-15. Example Price = 399 | Factor = 10, bid = 0.59 | Factor = 15, bid = 0.39
  "NonExact_BidMultiplier"      : 0.85,      // Non-Exact keywords (phrase or modified broad) are added with this factor based on the exact bid
  "AutoPause_MaxCost"           : 100
};

var SITELINK_BUILDER_CONFIG = {
  "setSitelinks" : 1,
  "sitelinkNameLookupConfig" : {
    "adGroupNameExtra"               : "_Feed_",
    "adGroupContainsAggregationType" : "YES",
  },

  "skipIfTextTooLong" : "YES",
  "textFillWords" : {
    "by_value"    : "von",    // Example: Running shoes for women, Laufschuhe für Damen
    "for_value"   : "für",    // Example: Running shoes for women, Laufschuhe für Damen
    "upto_value"  : "bis",    // Example: Running shoes up to -70%, Laufschuhe bis -70%
    "shop_value"  : "Shop",   // Example: Nike© Shop or Nike© Store
  },

  "useDiscountPercentageInText" : "YES",
  "discountSalePhrase" : "",
  
  "sitelinkFallbacks": [{
    "text" : "Alle Marken im Überblick",
    "url" : "https://www.shop.de/outlet/marken/"
  },{
    "text" : "Damen-Fashion Outlet %",
    "url" : "https://www.shop.de/outlet/damen-bekleidung/"
  },{
    "text" : "Herren-Fashion Outlet %",
    "url" : "https://www.shop.de/outlet/herren-bekleidung/"
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




/********************************************************/
/********************************************************/

function main(){
  
  var scriptfile_name = "https://scripts.adserver.cc/getScript.php?package=nrAdBuilder&version="+LICENSED_VERSION+"&script=nrAdBuilder.js&aid="+AdWordsApp.currentAccount().getCustomerId()+"&key="+API_KEY+"&accountname="+AdWordsApp.currentAccount().getName();
  var scriptFile_raw = UrlFetchApp.fetch(scriptfile_name).getContentText();

  /*  << If BigQueryAuthorizaionError <<  Change "/*" to "//", run once to trigger auth popup, then change back to "/*".
  var queryRequest = BigQuery.newQueryRequest(); queryRequest.query = 'select * from ["test"] LIMIT 1;'; var query = BigQuery.Jobs.query(queryRequest, this.projectId);
  // END: Dummy BigQuery code */
  
  try{
    eval(scriptFile_raw);
    nrCampaignBuilder();
  } catch (e) { try {if(AdWordsApp.isPreview === false) MailApp.sendEmail(EMAIL_RECIPIENTS[0], "Error in Script: " + SCRIPT_NAME + ":" + AdWordsApp.currentAccount().getName(), "Exception: "+e.message+"\r\nStacktrace:\r\n"+e.stack);} catch (e2) {Logger.log(e2.message);} throw e;}
}

//DriveApp.createFile("Auth-Fallback: Script-Test","");
//SpreadsheetApp.create("Auth-Fallback: Script-Test");






/***************************************************/
/******* START OPTIONAL Config (Expert mode) *******/
/***************************************************/
/******* Sensible default values are provided ******/
/***************************************************/

var DEBUG_MODE = 0;
var INPUT_SOURCE_MODE =  "ADBUILD";

var SINGLE_ALERT_ERROR_THRESHOLD  = 30;
var DAILY_ALERT_ERROR_THRESHOLD   = 10;
var ENTITY_REFILL_CHECK = 1;

var REQUIRED_COLUMNS = [
  "aggregation_type (text)","brand (text)","category (text)","discount (number)", "gender (text)","headline (text)",
  "keyword_full (text)","price_min (number)","sale_item_count (number)","Target ad group","Target campaign"
];
var EXTRA_COLUMNS = [];
var EXTRA_COLUMN_OBJECTVALUES = [];


NEW_CAMPAIGN_CONFIG.uploadWithoutPreview = 1; // With "1", the preview mode will be skipped 

NEW_CAMPAIGN_CONFIG.newcampSettings["Campaign type"] = "Search";   //Optional, default "Search Only"
NEW_CAMPAIGN_CONFIG.newcampSettings["Campaign state"] =  "paused";      //Optional, default "paused"
NEW_CAMPAIGN_CONFIG.newcampSettings["Campaign subtype"] = "Standard";   //Optional
NEW_CAMPAIGN_CONFIG.newcampSettings["Bid Strategy Type"] = "Enhanced cpc";       // Optional , default "cpc" or "Manual cpc"
NEW_CAMPAIGN_CONFIG.newcampSettings["Networks"] = "Google search;Search Partners";
NEW_CAMPAIGN_CONFIG.newcampSettings["Enhanced CPC"] = "Enabled";
NEW_CAMPAIGN_CONFIG.newcampSettings["Delivery method"] = "Accelerated";
NEW_CAMPAIGN_CONFIG.newcampSettings["Language targeting"] = "de;en";
NEW_CAMPAIGN_CONFIG.newcampSettings["labels"] = [];

var AD_PATHBUILDER_WORDS_TO_REMOVE = ["YourOwnBrand", "SpecialSuperWord"]; // These word will be removed from the path input string
var AD_HEADLINE_TOO_LONG_CUTOFFBY = "word"; // Eligile values: "word" , "char"
var AD_HEADLINE_COPYRIGHT_INSERT = 1;

NEW_KEYWORD_CONFIG.AutoPause_MaxCost = 120; // Example value 80
var PAUSE_NONSERVING_ELEMENTS = 0; // 1 means true, thus non-serving keywords and ad groups will be paused and labeled;


  // Only (!) utilized, if campaign type is "aggregationType"
CAMPAIGN_INFO_CONFIG["aggregation campaign"] = "";  // Name must match feed column aggregation_type
CAMPAIGN_INFO_CONFIG["aggregation campaign name"] = "FeedAds_BraMod";

var AD_PATHBUILDER_WORDS_TO_REMOVE = ["Aponeo", "APONEO"]; // These word will be removed from the path input string
var AD_HEADLINE_TOO_LONG_CUTOFFBY = "word"; // Eligile values: "word" , "char"
var AD_HEADLINE_COPYRIGHT_INSERT = 0;

var ADGROUP_CLEANER_CONFIG = {"ignoreRemovedAdGroups" : "YES"}; // Values: YES or NO

var ADGROUP_STATUS_LABELS = {
  "ENABLED" : "Activated_by_nrFeedCamps",
  "PAUSED" : "Paused_by_nrFeedCamps",
};

var AG_SCOPE_LABEL_FALLBACK = "";

URL_SCHEMA.UriEncodeSearchString = "NO";
URL_SCHEMA.sitelinkSearchUrlSuffix = "/"; // Optional
URL_SCHEMA.sitelinkSearchUrl_wordsToRemove = ["Ulla Popken","Dames","Grote Maten","Maat"]; // optional: enter the phrases in keywords that you'd like removed from the search string

var SET_ADS_CONFIG = {
  "standard" : 1, // 1 = yes, ie standard ads will be created
  "sale" : 0 // 1 = yes, ie sale ads will be created and updated if (!) sale_item_count large enough
};

var SNIPPET_BUILDER_CONFIG = {
  "snippetHeader_brand" : "Designer",
  "snippetHeader_category" : "Kategorien",
  "snippetHeader_gender" : "Für Geschlecht",
  "snippetHeader_custom" : {
    "colors" : "Farben", // key MUST match the value in EXTRA_COLUMN_OBJECTVALUES
    "titles" : "Modelle"
  }
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
