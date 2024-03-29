/* New features Bergzeit June 2019
- Query cleaning layer to remove typos
- rewrite adgroup build logic to sort entities
*/

/**
 * [nrSearchqueryAutomator description]
 * @return {[type]} [description]
 */
function nrSearchqueryAutomator() {

	// 0. Load queries
	var queryFetcher = new QueryFetcher();
	var queriesNew = queryFetcher.getNewPaidQueries();
	if (NEW_ORGANIC_QUERY_CONFIG.loadOrganicQueries === 1) queriesNew.concat(queryFetcher.getNewOrganicQueries(queriesNew));
	//queriesNew.concat

	// 1. Fetch entities
	if (COLUMN_SEPARATOR !== ",") throw new Error("ColumnSeparatorError: Your current column separator value '" + COLUMN_SEPARATOR + " MUST be ',' (or COMMA) to work as an AdWords business data feed. Please update your feed separator (and make sure strings are enclosed with quotes).");
	var feed = Utilities.parseCsv(UrlFetchApp.fetch(FEED_URL), COLUMN_SEPARATOR);
	var columnMapper = new FeedColumnValidator(feed, SQA_REQUIRED_COLUMNS, SQA_EXTRA_COLUMNS).getColumnMapper();
	var entityDataFetcher = new EntityDataFetcher(columnMapper);

	var entitiesObject = {};
	entitiesObject.brands = entityDataFetcher.getBrands();
	entitiesObject.categories = entityDataFetcher.getCategories();
	entitiesObject.titles = entityDataFetcher.getTitles();
	entitiesObject.genders = entityDataFetcher.getGenders(); // ["damen", "herren", "mädchen", "jungen", "kinder", "baby"];
	entitiesObject.colors = entityDataFetcher.getColors();
	entitiesObject.sizes = entityDataFetcher.getSizes();
	entitiesObject.custom_attributes = {};
	for (var custom_attribute in CUSTOM_WORDS) {
		entitiesObject.custom_attributes[custom_attribute] = CUSTOM_WORDS[custom_attribute];
	}

	// 2. Match entities to queries
	var queryToEntityMatcher = new QueryToEntityMatcher(queriesNew, entitiesObject);
	var entityMatches = queryToEntityMatcher.calculateEntityMatches();
	
	// 3. Look for search results for the specific query
	if (INSTOCK_CHECKER_CONFIG.active == 1) {
		var instockchecker = new InStockChecker(entityMatches);
		instockchecker.addInStockInfo();
	}

	// 4. For title match, enhance parent entities
	var parentEntityEnhancer = new ParentEntityEnhancer();
	var enhancedEntityMatches = parentEntityEnhancer.addBrandsAndCategories(entityMatches, entityDataFetcher);


	// 5. Execute upload or print to sheet: Decide if existing adgroup or new
	var matchedStructureEnhancer = new MatchedStructureEnhancer(enhancedEntityMatches);
	var fullDataEntityMatches = matchedStructureEnhancer.addStructureMatches();
	var fedMatches_Sliced = fullDataEntityMatches.slice(0, 49);
	Logger.log(fullDataEntityMatches.length + " fullDataEntityMatches found. First 50 entries : " + JSON.stringify(fedMatches_Sliced));

	// Early return if no new queries
	if (fullDataEntityMatches.length === 0) return Logger.log("No new queries to be added --- Have a nice Google Ads day!");

	// 5. Set up sync wiring via feed campaigns or search updates > use link checker deluxe

	// 6. Get AG object for feed campaign upload
	var adGroupObjectConverter = new AdGroupObjectConverter(fullDataEntityMatches);
	var adGroupObject = adGroupObjectConverter.getAdGroupObjects();
	Logger.log("%s validated entitityDataMatches found.", adGroupObject.length);
	if (DEBUG_MODE === 1) Logger.log("Adgroup Object: " + JSON.stringify(adGroupObject));

	var feed_content = [];

	feed_content.push([
		"aggregation_type (text)", "brand (text)", "category (text)", "discount (number)", "gender (text)",
		"headline (text)", "keyword_full (text)", "price_min (number)", "sale_item_count (number)", "Target ad group", "Target campaign", "urlsuffix (text)", "matchAccuracy (number)"
	]);

	for (var i = 0; i < adGroupObject.length; i++) {
		feed_content.push([
			adGroupObject[i].aggregationType,
			adGroupObject[i].brand,
			adGroupObject[i].category,
			"",
			adGroupObject[i].gender,
			adGroupObject[i].headline,
			adGroupObject[i].kwWithUnderscore,
			"",
			"",
			adGroupObject[i].adGroup,
			adGroupObject[i].campaign,
			adGroupObject[i].urlSuffix,
			adGroupObject[i].matchAccuracy
		]);
	}

	if (DEBUG_MODE === 1) Logger.log(feed_content);

	if (feed_content.length === 1) {
		Logger.log(" ");
		Logger.log("*****");
		Logger.log("nrSQA returned no new queries that passed the InStockChecker and TermSimilarity.");
		Logger.log(">> Please check your NEW_PAID_QUERY_CONFIG and your IN_STOCK_CHECKER configuration results.");
		Logger.log("Until then, have a nice Google Ads Day! ");
		Logger.log("*****");
		return;
	}

	// MCC Compatibility
	if (typeof MULTI_ACCOUNT_QUERY_TRANSFER !== "undefined" && typeof MccApp !== "undefined") {
		var targetAccount = MccApp.accounts().withIds([MULTI_ACCOUNT_QUERY_TRANSFER.targetAccountId]).get().next();
		MccApp.select(targetAccount);
		Logger.log("MCC Mode | target-account : " + targetAccount.getName());
	}

	nrCampaignBuilder(feed_content);

	if(typeof STRUCTURE_IDENTIFIER.newadgroups.setExactAndBmmAdGroups != "undefined" && STRUCTURE_IDENTIFIER.newadgroups.setExactAndBmmAdGroups && STRUCTURE_IDENTIFIER.newadgroups.bmmAdgroupSuffix != "undefined" && STRUCTURE_IDENTIFIER.newadgroups.bmmAdgroupPrefix != "undefined"){
		Logger.log("Second nrCampaignBuilder call for bmm adgroups.");
		
		var adgroup_suffix = STRUCTURE_IDENTIFIER.newadgroups.newAdgroupSuffix;
		var adgroup_prefix = STRUCTURE_IDENTIFIER.newadgroups.newAdgroupPrefix;
		
		// change name of adgroup and campaign
		for(var z = 1; z < feed_content.length; z++){

			feed_content[z][9] = feed_content[z][9].replace(adgroup_suffix,"").replace(adgroup_prefix,"");
			feed_content[z][9] = STRUCTURE_IDENTIFIER.newadgroups.bmmAdgroupPrefix + feed_content[z][9] + STRUCTURE_IDENTIFIER.newadgroups.bmmAdgroupSuffix;

			if(typeof NEW_CAMPAIGN_CONFIG.setExtraBMMCampaign != "undefined" && typeof NEW_CAMPAIGN_CONFIG.extraBMMCampaignSuffix != "undefined" && NEW_CAMPAIGN_CONFIG.setExtraBMMCampaign === 1 && NEW_CAMPAIGN_CONFIG.extraBMMCampaignSuffix.length > 0){
				feed_content[z][10] = feed_content[z][10] + NEW_CAMPAIGN_CONFIG.extraBMMCampaignSuffix;
			}
			
		}
		// set global variables for correct keyword matchtype creation
		NEW_CAMPAIGN_CONFIG.allowedMatchTypes = "nonExact";
		NEW_KEYWORD_CONFIG.NonExact_Phrase_or_MobBroad = "MB";
		Logger.log(feed_content[0]);
		Logger.log(feed_content[1]);
		Logger.log(feed_content[2]);
		
		// second call to nrCampaignBuilder with modified adgroup and campaign names and different matchtype variables
		nrCampaignBuilder(feed_content);

	}


}



////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
///////////////////////////////////// PROTOTYPES & METHODS /////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////


/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////////////////////////////////////////// 
//
// 0. FEEDCOLUMNVALIDATOR @prototype
//
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////////////////////////////////////////// 


function FeedColumnValidator(feedContent,requiredColums,extraColumns){
  this.requiredKeyArray = requiredColums;
  this.feedContent = feedContent;
  this.columnSeparator = COLUMN_SEPARATOR;
  this.extraKeyArray = extraColumns;
}


/*
* @return object columnMapper
* @throws exception NoExtraColumnInfo
* @throws error ColumnSeparatorError
* @throws error MissingRequiredColumnError
*/
FeedColumnValidator.prototype.getColumnMapper = function() {
  var headerColumn = this.feedContent[0];
  var columnMapper = {};

  // add extra key to required array
  try{
    if(this.extraKeyArray) {
      var extraKeyArray = this.extraKeyArray;
      for(var i=0; i<extraKeyArray.length; i++){
        this.requiredKeyArray.push(extraKeyArray[i].toLowerCase());
      }
    }
  } catch(e){Logger.log("NoExtraColumnInfo: No additional, account-specfic columns were added to feed.");}
  
  for(var k=0; k<headerColumn.length; k++){
    columnMapper[headerColumn[k].toLowerCase()] = k;
  }
  for(var j=0; j<this.requiredKeyArray.length; j++) {
    if(!columnMapper.hasOwnProperty(this.requiredKeyArray[j].toLowerCase())){
      Logger.log(this.requiredKeyArray);
      throw new Error("MissingRequiredColumnError : " + this.requiredKeyArray[j] + " does not exist in feed. Please make sure all these columns exist");
    }
  }
  Logger.log("Validated columnMapper : " + JSON.stringify(columnMapper));

  return columnMapper;
};


/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////////////////////////////////////////// 
//
// 0. QUERYFETCHER @prototype
//
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////////////////////////////////////////// 

/**
 * [QueryFetcher description]
 */
function QueryFetcher() {
	this.newPaidQueryConfig = NEW_PAID_QUERY_CONFIG;
	this.newOrganicQueryConfig = NEW_ORGANIC_QUERY_CONFIG;
}


/**
 * [getNewPaidQueries description]
 * @return {array} queries
 * @throws {error} SearchQuerySelectException
 */
QueryFetcher.prototype.getNewPaidQueries = function() {

	Logger.log(" ");
	Logger.log("******");
	Logger.log("Starting new paid query fetch with filters: time_span " + NEW_PAID_QUERY_CONFIG.timeSpan + " | " + NEW_PAID_QUERY_CONFIG.kpiThresholds[0].metric + " " + NEW_PAID_QUERY_CONFIG.kpiThresholds[0].operator + " " + NEW_PAID_QUERY_CONFIG.kpiThresholds[0].value);
	Logger.log(" ");
	if (DEBUG_MODE === 1) Logger.log(JSON.stringify(NEW_PAID_QUERY_CONFIG));
	Logger.log(" ");

	var queries = [];
	var sqReport;

	try {
		var selectQuery =
			"SELECT Query,KeywordTextMatchingQuery,QueryMatchTypeWithVariant,CampaignName,AdGroupName,Clicks,Cost,Ctr,Conversions,CostPerConversion,ConversionValue " +
			"FROM SEARCH_QUERY_PERFORMANCE_REPORT " +
			"WHERE " + NEW_PAID_QUERY_CONFIG.kpiThresholds[0].metric + " " + NEW_PAID_QUERY_CONFIG.kpiThresholds[0].operator + " " + NEW_PAID_QUERY_CONFIG.kpiThresholds[0].value + " AND " +
			NEW_PAID_QUERY_CONFIG.kpiThresholds[1].metric + " " + NEW_PAID_QUERY_CONFIG.kpiThresholds[1].operator + " " + NEW_PAID_QUERY_CONFIG.kpiThresholds[1].value + " AND " +
			NEW_PAID_QUERY_CONFIG.kpiThresholds[2].metric + " " + NEW_PAID_QUERY_CONFIG.kpiThresholds[2].operator + " " + NEW_PAID_QUERY_CONFIG.kpiThresholds[2].value + " AND " +
			"AdNetworkType2 = 'SEARCH' AND " +
			"CampaignName DOES_NOT_CONTAIN " + NEW_PAID_QUERY_CONFIG.campaignExclude + " " +
			"DURING " + NEW_PAID_QUERY_CONFIG.timeSpan;

		sqReport = AdWordsApp.report(selectQuery);
	} catch (e) {
		throw new Error("SearchQuerySelectException: " + e + ". Stacktrace: " + e.stack);
	}

	var sqReportRows = sqReport.rows();

	try {
		sqReportRows.next();
	} catch (e) {
		Logger.log("EmptyResponseException: Please recheck your filters, your query returned zero results. " + e + " . stack : " + e.stack);
	}

	try {
		while (sqReportRows.hasNext()) {
			var row = sqReportRows.next();

			var queryString = row["Query"];
			var allQueryStrings = [];

			if (row["Query"] === row["KeywordTextMatchingQuery"].toLowerCase()) continue;
			if (allQueryStrings.indexOf(queryString) != -1) continue;

			// Skip if contains excluded word
			if (typeof NEW_PAID_QUERY_CONFIG.queryExclude != "undefined") {
				for (var k = 0; k < NEW_PAID_QUERY_CONFIG.queryExclude.length; k++) {
					var excludedString = NEW_PAID_QUERY_CONFIG.queryExclude[k].toLowerCase();
					if (row["Query"].indexOf(excludedString) != -1) continue;
				}
			}

			// Skip if minROAS levels are not matched
			var roas = row["ConversionValue"] / row["Cost"];
			if (roas < NEW_PAID_QUERY_CONFIG.kpiThresholds[3].minRoas) continue;
			if (typeof NEW_PAID_QUERY_CONFIG.kpiThresholds[3].maxRoas !== "undefined") {
				if(roas >= NEW_PAID_QUERY_CONFIG.kpiThresholds[3].maxRoas) continue;
			}

			var cpo = row["Cost"] / row["Conversions"];
			if (typeof NEW_PAID_QUERY_CONFIG.kpiThresholds[3].maxCPO !== "undefined") {
				if (NEW_PAID_QUERY_CONFIG.kpiThresholds[3].maxCPO !== 0 && cpo > NEW_PAID_QUERY_CONFIG.kpiThresholds[3].maxCPO) continue;
			}

			// If query is not common (as classified by Google Suggest), check for typo via Custom Search Engine
			if(this.queryFoundInSuggest(queryString) === false) queryString = this.cleanQuery(queryString);

			if (this.queryExistsAsKeyword(queryString)) continue;

			var query = {
				"queryString": queryString,
				"keywordTextMatchingQuery": row["KeywordTextMatchingQuery"],
				"campaign": row["CampaignName"],
				"adgroup": row["AdGroupName"]
			};

			allQueryStrings.push(queryString);
			queries.push(query);


			var maxAmount = 50; 
			if(STRUCTURE_IDENTIFIER.newadgroups.setExactAndBmmAdGroups === true) {
				maxAmount = maxAmount / 2;
			}
			
			if (queries.length > maxAmount) {
				break;
			}

		} // END WHILE report rows
	} catch (e) {
		Logger.log("KeywordLookupException: " + e + ". Stacktrace: " + e.stack);
	}

	Logger.log("Number of newPaidQueries in Total : " + queries.length + "."); if(queries.length > 50) Logger.log("Slicing and taking first 50...");

	return queries;
};


/**
 * [queryExistsAsKeyword description]
 * @param  {string} query
 * @return {bool} hasNext
 */
QueryFetcher.prototype.queryExistsAsKeyword = function(query) {

	// 0. MCC Compatibility: Search queries in target account
	if (typeof MULTI_ACCOUNT_QUERY_TRANSFER !== "undefined" && typeof MccApp !== "undefined") {
		var targetAccount = MccApp.accounts().withIds([MULTI_ACCOUNT_QUERY_TRANSFER.targetAccountId]).get().next();
		MccApp.select(targetAccount);
	}

	// 1. Determining relevant matchtypes
	var matchTypes = ["EXACT"];
	if (typeof NEW_PAID_QUERY_CONFIG.checkAgainst_Matchtypes != "undefined") {
		if (NEW_PAID_QUERY_CONFIG.checkAgainst_Matchtypes === "all") matchTypes = ["EXACT", "PHRASE", "BROAD", "BROAD"];
	}

	// 2. Determining campaign statuses
	var campaignStatusCondition = "CampaignStatus != REMOVED";
	if (typeof NEW_PAID_QUERY_CONFIG.checkAgainst_CampaignStatus != "undefined") {
		if (NEW_PAID_QUERY_CONFIG.checkAgainst_CampaignStatus === "enabledOnly") campaignStatusCondition = "CampaignStatus = ENABLED";
	}

	// 3. Determining adGroup status
	var adGroupStatusCondition = "AdGroupStatus != REMOVED";
	if (typeof NEW_PAID_QUERY_CONFIG.checkAgainst_AdGroupStatus != "undefined") {
		if (NEW_PAID_QUERY_CONFIG.checkAgainst_AdGroupStatus === "enabledOnly") adGroupStatusCondition = "AdGroupStatus = ENABLED";
	}

	// 4. Determining keyword status
	var keywordStatusCondition = "Status != REMOVED";
	if (typeof NEW_PAID_QUERY_CONFIG.checkAgainst_KeywordStatus != "undefined") {
		if (NEW_PAID_QUERY_CONFIG.checkAgainst_KeywordStatus === "enabledOnly") keywordStatusCondition = "Status = ENABLED";
	}

	// 5. Running keyword iterator
	var keywordExists = false;

	for (var i = 0; i < matchTypes.length; i++) {
		if (matchTypes.length === 4 && i === 3) query = "+" + query.replace(/ /g, " +");

		// 5.1 Search for lowercase keyword
		var keywordIteratorLc = AdWordsApp.keywords().withCondition('Text = "' + query + '"')
			.withCondition("KeywordMatchType = " + matchTypes[i])
			.withCondition(campaignStatusCondition).withCondition(adGroupStatusCondition).withCondition(keywordStatusCondition).get();
		if (keywordIteratorLc.totalNumEntities() > 0) keywordExists = true;

		// 5.2 Search for First letter uppercase keyword
		if (keywordExists === false) {
			var queryUpperCaseFirstLetter = query.charAt(0).toUpperCase() + query.slice(1);
			var keywordIteratorFlUc = AdWordsApp.keywords().withCondition('Text = "' + queryUpperCaseFirstLetter + '"')
				.withCondition("KeywordMatchType = " + matchTypes[i])
				.withCondition(campaignStatusCondition).withCondition(adGroupStatusCondition).withCondition(keywordStatusCondition).get();

			if (keywordIteratorFlUc.totalNumEntities() > 0) keywordExists = true;
		}

		// 5.3 Search for keyword version with all first letters uppercase
		if (query.split(" ").length === 1) continue;

		if (keywordExists === false) {
			var queryUcAllFirstLetterArray = query.split(" ");
			var queryUpperCaseAllFirstLetters = [];
			for (var j = 0; j < queryUcAllFirstLetterArray.length; j++) {
				var queryTempString = queryUcAllFirstLetterArray[j].charAt(0).toUpperCase() + queryUcAllFirstLetterArray[j].slice(1);
				queryUpperCaseAllFirstLetters.push(queryTempString);
			}
			queryUpperCaseAllFirstLetters = queryUpperCaseAllFirstLetters.join(" ");

			var keywordIteratorAllFlUc = AdWordsApp.keywords().withCondition('Text = "' + queryUpperCaseAllFirstLetters + '"')
				.withCondition("KeywordMatchType = " + matchTypes[i])
				.withCondition(campaignStatusCondition).withCondition(adGroupStatusCondition).withCondition(keywordStatusCondition).get();

			if (keywordIteratorAllFlUc.totalNumEntities() > 0) keywordExists = true;
		}

		// 5.4 Search for min 3word keyword with Starts_with_ignore case version with all first letters uppercase
		var queryWordCount = query.split(" ");
		if (keywordExists === false && queryWordCount.length > 1) {

			var keywordIteratorMin3Word = AdWordsApp.keywords().withCondition('Text STARTS_WITH_IGNORE_CASE "' + query + '"')
				.withCondition("KeywordMatchType = " + matchTypes[i])
				.withCondition(campaignStatusCondition).withCondition(adGroupStatusCondition).withCondition(keywordStatusCondition).get();

			if (keywordIteratorMin3Word.totalNumEntities() > 0) {
				while (keywordIteratorMin3Word.hasNext()) {
					var keyword = keywordIteratorMin3Word.next().getText().toLowerCase();
					if (matchTypes.length === 1 && i === 0) keyword = keyword.replace('[', '').replace(']', '');
					if (matchTypes.length === 4 && i === 1) keyword = keyword.replace('"', '').replace('"', '');

					if (keyword === query) keywordExists = true;
				}
			}
		} // END if 5.4 min 3word
	} // END FOR Loop matchtypes

	// 0. MCC Compatibility: Switch back to soure account
	if (typeof MULTI_ACCOUNT_QUERY_TRANSFER !== "undefined" && typeof MccApp !== "undefined") {
		var sourceAccount = MccApp.accounts().withIds([MULTI_ACCOUNT_QUERY_TRANSFER.sourceAccountId]).get().next();
		MccApp.select(sourceAccount);
	}

	return keywordExists;
};



/**
* @param {string} keyword, a keyword with pluses instead of spaces
* @return {bool} keywordFoundInSuggestList, if the query is contained in the list
**/
QueryFetcher.prototype.queryFoundInSuggest = function (keyword) {
  var firstEntry;
  var xmlRequestUrl = "https://suggestqueries.google.com/complete/search?output=toolbar&hl=de&q=" + keyword;
  var xmlDocument = XmlService.parse(UrlFetchApp.fetch(xmlRequestUrl).getContentText());
  
  try {
  	var keywordFoundInSuggestList = false; 
  	var suggestions = xmlDocument.getRootElement().getChildren('CompleteSuggestion'); 

  	for(var i=0; i < suggestions.length; i++) {
      	var singleEntry = suggestions[i].getChild('suggestion').getAttribute('data').getValue(); 
      	Logger.log(singleEntry)
  		if(singleEntry == keyword) keywordFoundInSuggestList = true;
  	}

  } catch(e) {if(DEBUG_MODE === 1) Logger.log("No Google suggest entry found for : " + keyword);}
  
  return keywordFoundInSuggestList;
}

/**
 * @param  {string} query
 * @return {string} correctedQuery
 */
QueryFetcher.prototype.cleanQuery = function(query) {
  
  var correctedQuery, response, url;
  
  // Retrieve the CSE id from your project console: https://cse.google.com/cse/all
  var cx = "011253106589242236363:g6cntpa1c7s";
  // Create an API after here after selecting your project: https://developers.google.com/custom-search/v1/introduction
  var api_key = 'AIzaSyA5dKxNMaFoHDbEeukFQkiMUTJTuvzoteg';
  var api_endPoint_free = 'https://www.googleapis.com/customsearch/v1';
 
  try{
    url = api_endPoint_free + '?cx=' + cx + '&key=' + api_key + '&googlehost=de&gl=de&q=' + query + '&alt=json&num=1';
    response = JSON.parse(UrlFetchApp.fetch(url).getContentText());
  }
  catch(e) {
    try{
      // Fallback to restricted & paid CSE
      if(DEBUG_MODE === 1) Logger.log("Free daily API Limit reached. Moving to restricted search API...");
      var api_endPoint_paid = 'https://www.googleapis.com/customsearch/v1/siterestrict';
      url = api_endPoint_paid + '?cx=' + cx + '&key=' + api_key + '&googlehost=de&gl=de&q=' + query + '&alt=json&num=1';
      response = JSON.parse(UrlFetchApp.fetch(url).getContentText());
    } catch(e2) {
        Logger.log(e2 + " . stack : " + e2.stack);
        return correctedQuery;
    }
  }
  
  if(typeof response.spelling !== "undefined") correctedQuery = response.spelling.correctedQuery.replace(',',' ').replace('.',' ');

  return correctedQuery;
}


/**
 * [getNewOrganicQueries description]
 * @param  {array} queriesNew [description]
 * @return {array} newOrganicQueries
 * @throws {error} SearchQuerySelectException
 */
QueryFetcher.prototype.getNewOrganicQueries = function(queriesNew) {

	Logger.log(" ");
	Logger.log("******");
	Logger.log("Starting new organic query fetch");
	Logger.log(" ");
	if (DEBUG_MODE === 1) Logger.log(JSON.stringify(NEW_ORGANIC_QUERY_CONFIG));
	Logger.log(" ");

	var newOrganicQueries = [];
	var organicQueryReport;
	try {
		var selectQuery =
			"SELECT SearchQuery , KeywordTextMatchingQuery , AverageCpc , Clicks , OrganicClicks , CombinedAdsOrganicClicks , AveragePosition , OrganicAveragePosition , Impressions , OrganicImpressions , Ctr " +
			"FROM PAID_ORGANIC_QUERY_REPORT " +
			"WHERE " + NEW_ORGANIC_QUERY_CONFIG.kpiThresholds[0].metric + " " + NEW_ORGANIC_QUERY_CONFIG.kpiThresholds[0].operator + " " + NEW_ORGANIC_QUERY_CONFIG.kpiThresholds[0].value + " AND " +
			NEW_ORGANIC_QUERY_CONFIG.kpiThresholds[1].metric + " " + NEW_ORGANIC_QUERY_CONFIG.kpiThresholds[1].operator + " " + NEW_ORGANIC_QUERY_CONFIG.kpiThresholds[1].value + " AND " +
			NEW_ORGANIC_QUERY_CONFIG.kpiThresholds[2].metric + " " + NEW_ORGANIC_QUERY_CONFIG.kpiThresholds[2].operator + " " + NEW_ORGANIC_QUERY_CONFIG.kpiThresholds[2].value + " AND " +
			"CampaignName DOES_NOT_CONTAIN " + NEW_ORGANIC_QUERY_CONFIG.campaignExclude + " AND CampaignStatus != REMOVED " +
			"DURING " + NEW_ORGANIC_QUERY_CONFIG.timeSpan + " ";

		organicQueryReport = AdWordsApp.report(selectQuery);
	} catch (e) {
		throw new Error("SearchQuerySelectException: " + e + ". Stacktrace: " + e.stack);
	}

	var oQReportRows = organicQueryReport.rows();
	try {
		oQReportRows.next();
	} catch (e) {
		Logger.log("EmtpyResponeException: Please recheck your filters, your query returned zero results. " + e + " . stack : " + e.stack);
	}

	try {
		while (oQReportRows.hasNext()) {
			var row = oQReportRows.next();

			var queryString = row["SearchQuery"];
			if (row["SearchQuery"] === row["KeywordTextMatchingQuery"]) continue;
			if (this.queryExistsAsKeyword(queryString)) continue;

			for (var i = 0; i < queriesNew.length; i++) {
				if (row["SearchQuery"] === queriesNew[i].queryString) continue;
			}
			var query = {
				"queryString": row["SearchQuery"],
				"keywordTextMatchingQuery": row["KeywordTextMatchingQuery"],
				"campaign": "___source_organic",
				"adgroup": "___source_organic"
			};
			newOrganicQueries.push(query);
		}
	} catch (e) {
		Logger.log("KeywordLookupException: " + e + ". Stacktrace: " + e.stack);
	}

	if (DEBUG_MODE == 1) Logger.log("newOrganicQueries : " + JSON.stringify(newOrganicQueries));

	return newOrganicQueries;
};

/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////////////////////////////////////////// 
//
// 1. ENTITYDATAFETCHER @prototype
//
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////   

/**
 * [EntityDataFetcher description]
 * @param {[type]} columnMapper [description]
 */
function EntityDataFetcher(columnMapper) {

	this.columnMapper = columnMapper;
	this.feedContent = this.getFeedContent();

}

/**
 * [getFeedContent description]
 * @return {array} feedContent, two-dimensional array of feed content
 */
EntityDataFetcher.prototype.getFeedContent = function() {

	var response = UrlFetchApp.fetch(FEED_URL);
	var feedContent = Utilities.parseCsv(response, COLUMN_SEPARATOR);

	return feedContent;
};

/**
 * [getCategories description]
 * @return {array} categoriesArray
 */
EntityDataFetcher.prototype.getCategories = function() {

	var catsArray = [];

	for (var i = 1; i < this.feedContent.length; i++) {
		var product = this.feedContent[i];

		// Add category to catsArray
		var productCat = product[this.columnMapper["product_type"]];
		var productCat_split = productCat.split(">");
		var final_productCatArray = [];
		for (var p = 0; p < productCat_split.length; p++) {
			var tempSplit = productCat_split[p].replace(/^\s|\s$/, "").replace(/-/g, " ").toLowerCase().split(/\s/g);
			for (var z = 0; z < tempSplit.length; z++) {
				if (tempSplit[z] && tempSplit[z].length > 2) {
					final_productCatArray.push(tempSplit[z].replace(/^\s|\s$/, "").toLowerCase());
				}
			}
		}
		for (var k = 0; k < final_productCatArray.length; k++) {
			var splitCat = final_productCatArray[k].toLowerCase().replace(/^\s|\s$/, "");
			var nonSplitCat;

			for (var j = 0; j < CORECAT_ARRAY_PLURAL.length; j++) {
				if (final_productCatArray[k].indexOf(CORECAT_ARRAY_PLURAL[j]) != -1) {
					var regexString = new RegExp(CORECAT_ARRAY_PLURAL[j], "g");
					var replaceTerm = CORECAT_ARRAY_SINGULAR[j] ? CORECAT_ARRAY_SINGULAR[j] : CORECAT_ARRAY_PLURAL[j];

					splitCat = final_productCatArray[k].replace(regexString, " " + replaceTerm).toLowerCase().replace(/ae/g, "ä").replace(/ue/g, "ü").replace(/oe/g, "ö").replace(/^\s|\s$/, "");
					nonSplitCat = final_productCatArray[k].replace(regexString, replaceTerm).toLowerCase().replace(/ae/g, "ä").replace(/ue/g, "ü").replace(/oe/g, "ö");
					break;
				}
			}
			if (nonSplitCat) {
				catsArray.push(nonSplitCat);
			}
			catsArray.push(splitCat); //catsArray.push(final_productCatArray[k].toLowerCase().replace(/-/g," "));
		}
	} // END Feed content LOOP
	catsArray = this.deduplicateArrayValues(catsArray);
	return catsArray;
};

/**
 * [getTitles description]
 * @return {array} titlesArray
 */
EntityDataFetcher.prototype.getTitles = function() {

	var titlesArray = [];

	for (var i = 1; i < this.feedContent.length; i++) {
		var product = this.feedContent[i];
		var splitTitle = product[this.columnMapper["title"]].toLowerCase().replace(/-/g, " ");

		for (var j = 0; j < CORECAT_ARRAY_SINGULAR.length; j++) {
			if (product[this.columnMapper["title"]].indexOf(CORECAT_ARRAY_SINGULAR[j]) != -1) {
				var regexString = new RegExp(CORECAT_ARRAY_SINGULAR[j], "g");
				splitTitle = product[this.columnMapper["title"]].replace(regexString, " " + CORECAT_ARRAY_SINGULAR[j]).replace("  ", " ");
			}
		}
		titlesArray.push(splitTitle.replace(/-/g, " ").replace(/  /g, " "));
	}
	titlesArray = this.deduplicateArrayValues(titlesArray);

	return titlesArray;
};

/**
 * [getBrands description]
 * @return {array} brandsArray
 */
EntityDataFetcher.prototype.getBrands = function() {

	var brandsArray = [];
	for (var i = 1; i < this.feedContent.length; i++) {
		try {
			var product = this.feedContent[i];
			if (product[this.columnMapper["brand"]].length > 3) {
				var cleanedBrandString = product[this.columnMapper["brand"]].toLowerCase().replace(".", "").replace("!", "").replace("©", "").replace("?", "").replace(";", "").replace("|", "").replace("*", "").replace("\\", "").replace(/-/g, " ");
				brandsArray.push(cleanedBrandString);
				if (cleanedBrandString.toLowerCase().indexOf(" ") != -1) brandsArray.push(cleanedBrandString.replace(" ", ""));
			}
		} catch (e) {
			Logger.log("BrandFetchException: " + e + " . stack : " + e.stack);
		}
	}
	var dedup_brandsArray = this.deduplicateArrayValues(brandsArray);
	return dedup_brandsArray;
};

/**
 * [getGenders description]
 * @return {array} gendersArray
 */
EntityDataFetcher.prototype.getGenders = function() {
	var genderArray = [];
	genderArray.push("mädchen", "jungen", "girls", "boys", "children", "kids");
	for (var i = 1; i < this.feedContent.length; i++) {
		var product = this.feedContent[i];
		var gender = product[this.columnMapper["gender"]].toLowerCase();
		if (gender.length > 1) {
			genderArray.push(gender);
		}
	}
	var dedup_genderArray = this.deduplicateArrayValues(genderArray);

	return dedup_genderArray;
};

/**
 * [getCustomAttribute description]
 * @param  {string} attributeName [description]
 * @return {array} attributeArray
 */
EntityDataFetcher.prototype.getCustomAttribute = function(attributeName) {
	var attributeArray = [];

	for (var i = 1; i < this.feedContent.length; i++) {
		var product = this.feedContent[i];
		var attribute = product[this.columnMapper[attributeName]].toLowerCase();
		if (attribute.length > 3) {
			attributeArray.push(attribute);
		}
	}
	attributeArray = this.deduplicateArrayValues(attributeArray);

	return attributeArray;
};

/**
 * [getColors description]
 * @return {array} colorArray
 * @exception {exception} MissingOptionalColumnException
 */
EntityDataFetcher.prototype.getColors = function() {
	var colorArray = [];

	try {
		for (var i = 1; i < this.feedContent.length; i++) {
			var product = this.feedContent[i];
			var color = product[this.columnMapper["color"]].toLowerCase();
			if (color.length > 2) {
				colorArray.push(color);
			}
		}
		colorArray = this.deduplicateArrayValues(colorArray);
	} catch (e) {
		Logger.log("MissingOptionalColumnException: Column 'color' is missing in column spec.");
	}

	return colorArray;
};

/**
 * [getSizes description]
 * @return {array} colorArray
 * @exception {exception} MissingOptionalColumnException
 */
EntityDataFetcher.prototype.getSizes = function() {
	var sizeArray = [];

	try {
		for (var i = 1; i < this.feedContent.length; i++) {
			var product = this.feedContent[i];
			var size = product[this.columnMapper["size"]].toLowerCase();
			if (size.length > 0) {
				sizeArray.push(size);
			}
		}
		sizeArray = this.deduplicateArrayValues(sizeArray);
	} catch (e) {
		Logger.log("MissingOptionalColumnException: Column 'size' is missing in column spec.");
	}

	return sizeArray;
};

/**
 * [deduplicateArrayValues description]
 * @param  {string} array [description]
 * @return {array} deduplicated_array
 */
EntityDataFetcher.prototype.deduplicateArrayValues = function(array) {
	var cache = {};
	var deduplicated_array = [];
	for (var i = 0; i < array.length; i++) {
		if (!cache[array[i]]) {
			cache[array[i]] = array[i];
			deduplicated_array.push(array[i]);
		} else {
			continue;
		}
	}
	return deduplicated_array;
};

/**
 * [getBrandByTitle description]
 * @param  {string} title [description]
 * @return {string} brand
 */
EntityDataFetcher.prototype.getBrandByTitle = function(title) {

	var brand;

	for (var i = 1; i < this.feedContent.length; i++) {
		var product = this.feedContent[i];

		if (product[this.columnMapper["title"]].toLowerCase() == title.toLowerCase()) {
			brand = product[this.columnMapper["brand"]];
			break;
		}
	}

	return brand;
};

/**
 * [getLowestCategoryByTitle description]
 * @param  {string} title [description]
 * @return {string} categoryPath
 */
EntityDataFetcher.prototype.getLowestCategoryByTitle = function(title) {
	var categoryPath;
	var lowestCategory = "";
	for (var i = 1; i < this.feedContent.length; i++) {
		var product = this.feedContent[i];

		if (product[this.columnMapper["title"]].toLowerCase() == title.toLowerCase()) {
			categoryPath = product[this.columnMapper["product_type"]];
			var catArray = categoryPath.split(" > ");
			lowestCategory = catArray[catArray.length - 1];
			break;
		}
	}
	return lowestCategory;
};

/**
 * [getGenderByTitle description]
 * @param {string} title
 * @return {string} gender
 */
EntityDataFetcher.prototype.getGenderByTitle = function(title) {
	var gender = "";
	for (var i = 1; i < this.feedContent.length; i++) {
		var product = this.feedContent[i];

		if (product[this.columnMapper["title"]].toLowerCase() == title.toLowerCase()) {
			gender = product[this.columnMapper["gender"]];
			break;
		}
	}
	return gender;
};

/**
 * [getColorsByTitle description]
 * @param {string} title
 * @return {Array} colors
 */
EntityDataFetcher.prototype.getColorsByTitle = function(title) {
	var colors = [];
	for (var i = 1; i < this.feedContent.length; i++) {
		var product = this.feedContent[i];

		if (product[this.columnMapper["title"]].toLowerCase() == title.toLowerCase()) {
			colors.push(product[this.columnMapper["color"]]);
		}
	}
	return colors;
};

/**
 * [getSizesByTitle description]
 * @param {string} title
 * @return {Array} sizes
 */
EntityDataFetcher.prototype.getSizesByTitle = function(title) {
	var sizes = [];
	for (var i = 1; i < this.feedContent.length; i++) {
		var product = this.feedContent[i];

		if (product[this.columnMapper["title"]].toLowerCase() == title.toLowerCase()) {
			sizes.push(product[this.columnMapper["size"]]);
		}
	}
	return sizes;
};


/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////////////////////////////////////////// 
//
// 2. QUERY_TO_ENTITY_MATCHER @prototype
//
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////   
/**
 * [QueryToEntityMatcher description]
 * @param {[type]} queries        [description]
 * @param {[type]} entitiesObject [description]
 */
function QueryToEntityMatcher(queries, entitiesObject) {

	this.queries = queries;
	this.entitiesObject = entitiesObject;
	this.queryObjectEntities = {};
}


/**
 * [calculateEntityMatches description]
 * @return {object} entityMatches
 */
QueryToEntityMatcher.prototype.calculateEntityMatches = function() {

	var entityMatches = [{
		"overallModelSummary": {
			"instances": 0,
			"totalMatchValue": 0
		}
	}];

	for (var i = 0; i < this.queries.length; i++) {
		var queryObjectEntities = {
			"_overallMatchValue": 0,
			"_overallMatchedLetters": 0,
			"query": this.queries[i].queryString,
			"brand": {},
			"category": {},
			"gender": {},
			"titles": {},
			"sizes": {},
			"colors": {},
			"custom_attributes": {},

			"querySource": {
				"campaign": this.queries[i].campaign,
				"adgroup": this.queries[i].adgroup,
				"keywordTextMatchingQuery": this.queries[i].keywordTextMatchingQuery
			}
		};
		var query = this.queries[i].queryString;

		try {
			var result = this.extractFullBrands(query, queryObjectEntities);

			result = this.extractPartialBrands(result.query, result.queryObjectEntities);
			result = this.extractGender(result.query, result.queryObjectEntities);

			result = this.extractFullCategories(result.query, result.queryObjectEntities);
			result = this.extractPartialCategories(result.query, result.queryObjectEntities);

			result = this.extractFullTitles(result.query, result.queryObjectEntities);

			result = this.extractColor(result.query, result.queryObjectEntities);
			result = this.extractSize(result.query, result.queryObjectEntities);

			result = this.extractPartialTitles(result.query, result.queryObjectEntities);

			//result = this.getKeywordSuggestions(result.query, result.queryObjectEntities);

			for (var prop in this.entitiesObject.custom_attributes) {
				result = this.extractCustomAttribute(result.query, result.queryObjectEntities, prop);
				queryObjectEntities = result.queryObjectEntities;
				query = result.query;
			}

		} catch (e) {
			Logger.log(e.stack);
			throw e;
		}

		if (queryObjectEntities._overallMatchValue > 1) queryObjectEntities._overallMatchValue = 1; //queObEnt_all_Extracted
		entityMatches.push(queryObjectEntities);

		entityMatches[0].overallModelSummary.instances += 1;
		entityMatches[0].overallModelSummary.totalMatchValue += queryObjectEntities._overallMatchValue;
	} // END FOR LOOP QUERIES

	entityMatches[0].overallModelSummary.entityExtractionAccuracy = (entityMatches[0].overallModelSummary.totalMatchValue / entityMatches[0].overallModelSummary.instances).toFixed(2);
	entityMatches[0].overallModelSummary.totalMatchValue.toFixed(2);

	// if(DEBUG_MODE === 1) Logger.log("entityMatches : " + JSON.stringify(entityMatches));
	return entityMatches;
};


/////////////////////////////////////////////////
//
// 2.1. MATCH BRANDS
//
///////////////////////////////////////////////// 
/**
 * [extractFullBrands description]
 * @param  {string} query               [description]
 * @param  {array} queryObjectEntities [description]
 * @return {object} queryObjectEntities
 */
QueryToEntityMatcher.prototype.extractFullBrands = function(query, queryObjectEntities) {
	for (var j = 0; j < this.entitiesObject.brands.length; j++) {

		var brandInBetween = " " + this.entitiesObject.brands[j] + " ";
		var brandAtEnd = " " + this.entitiesObject.brands[j];
		var brandAtBeginning = this.entitiesObject.brands[j] + " ";

		// run full brand extraction
		if (query == this.entitiesObject.brands[j] || query.indexOf(brandInBetween) > -1 || query.indexOf(brandAtBeginning) === 0 || (query.indexOf(brandAtEnd) != -1 && query.indexOf(brandAtEnd) == (query.length - brandAtEnd.length))) {
			// if (DEBUG_MODE == 1) Logger.log("Brand " + this.entitiesObject.brands[j] + " found for query " + query);
			if (!queryObjectEntities.brand.fullMatch) {
				queryObjectEntities.brand.fullMatch = [{
					"maxMatchValue": 0.0,
					"maxMatchString": ""
				}];

			}

			var newEntry = {
				"matchedEntity": this.entitiesObject.brands[j],
				"matchValue": Math.round(this.entitiesObject.brands[j].replace(/ /g, "").length / query.replace(/ /g, "").length * 100) / 100
			};

			if (newEntry.matchValue > queryObjectEntities.brand.fullMatch[0].maxMatchValue) {
				queryObjectEntities.brand.fullMatch.push(newEntry);
				queryObjectEntities.brand.fullMatch[0].maxMatchValue = newEntry.matchValue;
				queryObjectEntities.brand.fullMatch[0].maxMatchString = newEntry.matchedEntity;
			}
		}
	}
	if (queryObjectEntities.brand.fullMatch) {
		query = query.replace(queryObjectEntities.brand.fullMatch[0].maxMatchString, "");
		queryObjectEntities._overallMatchValue += queryObjectEntities.brand.fullMatch[0].maxMatchValue;
		queryObjectEntities._overallMatchedLetters += queryObjectEntities.brand.fullMatch[0].maxMatchString.length;
	}
	// if(DEBUG_MODE === 1) {Logger.log("extractFullBrands: " + JSON.stringify(queryObjectEntities.brand.fullMatch));}

	return {
		queryObjectEntities: queryObjectEntities,
		query: query
	};
};

/**
 * [extractPartialBrands description]
 * @param  {string} query               [description]
 * @param  {array} queryObjectEntities [description]
 * @return {object} queryObjectEntities
 */
QueryToEntityMatcher.prototype.extractPartialBrands = function(query, queryObjectEntities) {

	for (var j = 0; j < this.entitiesObject.brands.length; j++) {

		var tokenizedBrandString = this.entitiesObject.brands[j].split(" ");
		if (!queryObjectEntities.brand.fullMatch) {

			for (var k = 0; k < tokenizedBrandString.length; k++) {
				if (tokenizedBrandString[k].length > 3 && query.indexOf(tokenizedBrandString[k]) > -1) {
					queryObjectEntities.brand.partialMatches = [{
						"maxMatchValue": 0.0,
						"maxMatchString": 0.0
					}];

					var partialString = tokenizedBrandString[k];

					// Try extending partial match to two wordbackmatch
					if (tokenizedBrandString[k - 1]) {
						var twoWordBackMatch = tokenizedBrandString[k - 1] + " " + tokenizedBrandString[k];
						if (query.indexOf(twoWordBackMatch) > -1) partialString = twoWordBackMatch;
					}

					// Try extending partial match to twoWordForwardMatch
					if (tokenizedBrandString[k + 1]) {
						var twoWordForwardMatch = tokenizedBrandString[k] + " " + tokenizedBrandString[k + 1];
						if (query.indexOf(twoWordForwardMatch) > -1) partialString = twoWordForwardMatch;
					}

					// Try extending partial match to threeWordBackMatch
					if (tokenizedBrandString[k - 2] && tokenizedBrandString[k - 1]) {
						var threeWordBackMatch = tokenizedBrandString[k - 2] + " " + tokenizedBrandString[k - 1] + " " + tokenizedBrandString[k];
						if (query.indexOf(threeWordBackMatch) > -1) partialString = threeWordBackMatch;
					}

					// Try extending partial match to threeWordWrapMatch
					if (tokenizedBrandString[k - 1] && tokenizedBrandString[k + 1]) {
						var threeWordWrapMatch = tokenizedBrandString[k - 1] + " " + tokenizedBrandString[k] + " " + tokenizedBrandString[k + 1];
						if (query.indexOf(threeWordWrapMatch) > -1) partialString = threeWordWrapMatch;
					}

					// Try extending partial match to threewordForwardmatch
					if (tokenizedBrandString[k + 1] && tokenizedBrandString[k + 2]) {
						var threeWordForwardMatch = tokenizedBrandString[k] + " " + tokenizedBrandString[k + 1] + " " + tokenizedBrandString[k + 2];
						if (query.indexOf(threeWordForwardMatch) > -1) partialString = threeWordForwardMatch;
					}

					var newEntry = {
						"matchedEntity": this.entitiesObject.brands[j],
						"matchString": partialString,
						"matchValue": Math.round(partialString.replace(/ /g, "").length / query.replace(/ /g, "").length * 100) / 100
					};

					query = query.replace(this.entitiesObject.brands[j], "");

					if (newEntry.matchValue > queryObjectEntities.brand.partialMatches[0].maxMatchValue) {
						queryObjectEntities.brand.partialMatches.push(newEntry);
						queryObjectEntities.brand.partialMatches[0].maxMatchValue = newEntry.matchValue;
						queryObjectEntities.brand.partialMatches[0].maxMatchString = newEntry.matchString;
					}
				}
			} // END for loop brand tokenized   
		}
	}
	if (queryObjectEntities.brand.partialMatches) {
		queryObjectEntities._overallMatchValue += queryObjectEntities.brand.partialMatches[0].maxMatchValue;
		queryObjectEntities._overallMatchedLetters += queryObjectEntities.brand.partialMatches[0].maxMatchString.length;
	}

	return {
		queryObjectEntities: queryObjectEntities,
		query: query
	};
};

/////////////////////////////////////////////////
//
// 2.2. MATCH GENDER
//
/////////////////////////////////////////////////

/**
 * [extractGender description]
 * @param  {string} query               [description]
 * @param  {array} queryObjectEntities [description]
 * @return {object} queryObjectEntities
 */
QueryToEntityMatcher.prototype.extractGender = function(query, queryObjectEntities) {

	for (var j = 0; j < this.entitiesObject.genders.length; j++) {
		if (query.indexOf(this.entitiesObject.genders[j]) > -1) {
			queryObjectEntities.gender.fullMatch = [{
				"matchedEntity": this.entitiesObject.genders[j],
				"matchValue": Math.round(this.entitiesObject.genders[j].replace(/ /g, "").length / queryObjectEntities.query.replace(/ /g, "").length * 100) / 100,
				"maxMatchString": this.entitiesObject.genders[j],
				"maxMatchValue": 1
			}];
			query = query.replace(this.entitiesObject.genders[j], "");
			queryObjectEntities._overallMatchValue += queryObjectEntities.gender.fullMatch[0].matchValue;
			queryObjectEntities._overallMatchedLetters += queryObjectEntities.gender.fullMatch[0].matchedEntity.length;
		}
	}
	return {
		queryObjectEntities: queryObjectEntities,
		query: query
	};
};


/////////////////////////////////////////////////
//
// 2.3. MATCH CATEGORIES
//
/////////////////////////////////////////////////

/**
 * [extractFullCategories description]
 * @param  {string} query               [description]
 * @param  {array} queryObjectEntities [description]
 * @return {object} queryObjectEntities
 */
QueryToEntityMatcher.prototype.extractFullCategories = function(query, queryObjectEntities) {

	for (var j = 0; j < this.entitiesObject.categories.length; j++) {

		if (query.indexOf(this.entitiesObject.categories[j]) > -1) {

			if (!queryObjectEntities.category.fullMatch) {
				queryObjectEntities.category.fullMatch = [{
					"maxMatchValue": 0.0,
					"maxMatchString": ""
				}];
			}

			var newEntry = {
				"matchedEntity": this.entitiesObject.categories[j],
				"matchValue": Math.round(this.entitiesObject.categories[j].replace(/ /g, "").length / queryObjectEntities.query.replace(/ /g, "").length * 100) / 100
			};

			if (newEntry.matchValue > queryObjectEntities.category.fullMatch[0].maxMatchValue) {
				queryObjectEntities.category.fullMatch.push(newEntry);
				queryObjectEntities.category.fullMatch[0].maxMatchValue = newEntry.matchValue;
				queryObjectEntities.category.fullMatch[0].maxMatchString = newEntry.matchedEntity;
			}
		}
	}
	if (queryObjectEntities.category.fullMatch) {
		query = query.replace(queryObjectEntities.category.fullMatch[0].maxMatchString, "");

		queryObjectEntities._overallMatchValue += queryObjectEntities.category.fullMatch[0].maxMatchValue;
		queryObjectEntities._overallMatchedLetters += queryObjectEntities.category.fullMatch[0].maxMatchString.length;
	}

	return {
		queryObjectEntities: queryObjectEntities,
		query: query
	};
};


/**
 * [extractPartialCategories description]
 * @param  {string} query               [description]
 * @param  {array} queryObjectEntities [description]
 * @return {object} queryObjectEntities
 */
QueryToEntityMatcher.prototype.extractPartialCategories = function(query, queryObjectEntities) {

	for (var j = 0; j < this.entitiesObject.categories.length; j++) {

		var tokenizedCatString = this.entitiesObject.categories[j].split(" ");

		for (var k = 0; k < tokenizedCatString.length; k++) {
			if (query.indexOf(tokenizedCatString[k]) > -1 && !queryObjectEntities.category.fullMatch) {

				if (!queryObjectEntities.category.partialMatches) {
					queryObjectEntities.category.partialMatches = [{
						"maxMatchValue": 0.0,
						"maxMatchString": ""
					}];
				}

				if (this.exitIfPartialCategoryEdgeCase(queryObjectEntities, this.entitiesObject.categories[j], tokenizedCatString[k]) === true) continue;

				var newEntry = {
					"matchedEntity": this.entitiesObject.categories[j],
					"matchString": tokenizedCatString[k],
					"matchValue": Math.round(tokenizedCatString[k].replace(/ /g, "").length / queryObjectEntities.query.replace(/ /g, "").length * 100) / 100
				};

				query = query.replace(this.entitiesObject.categories[j], "");


				if (newEntry.matchValue > queryObjectEntities.category.partialMatches[0].maxMatchValue) {
					queryObjectEntities.category.partialMatches.push(newEntry);
					queryObjectEntities.category.partialMatches[0].maxMatchValue = newEntry.matchValue;
					queryObjectEntities.category.partialMatches[0].maxMatchString = newEntry.matchString;
				}
			}
		} // END for loop brand tokenized 
	}
	if (queryObjectEntities.category.partialMatches) {
		queryObjectEntities._overallMatchValue += queryObjectEntities.category.partialMatches[0].maxMatchValue;
		queryObjectEntities._overallMatchedLetters += queryObjectEntities.category.partialMatches[0].maxMatchString.length;
	}

	return {
		queryObjectEntities: queryObjectEntities,
		query: query
	};
};


/*
 * @param {array} queryObjectEntities
 * @param {string} fullCategory
 * @param {string} partialCategory
 * @return {bool} isEdgeCase
 * @throws {exception} PartialCategoryEdgeCaseException 
 */
QueryToEntityMatcher.prototype.exitIfPartialCategoryEdgeCase = function(queryObjectEntities, fullCategory, partialCategory) {
	var isEdgeCase = false;

	var queObEnt_Bra = queryObjectEntities.brand;
	var queObEnt_Cat = queryObjectEntities.category;
	var queObEnt_Gen = queryObjectEntities.gender;

	try {
		// Collection of EDGE CASES
		// 1. Prevent if fully category matched
		if (queObEnt_Cat.fullMatch && queObEnt_Cat.fullMatch.length > 0) {
			if (queObEnt_Cat.fullMatch.length > 0 && queObEnt_Cat.fullMatch[0].maxMatchString.indexOf(fullCategory) > -1) {
				isEdgeCase = true;
			}
		}

		// 2. Prevent if fully brand matched
		if (queObEnt_Bra.fullMatch) {
			if (queObEnt_Bra.fullMatch[1]) {
				if (queObEnt_Bra.fullMatch.length > 0 && queObEnt_Bra.fullMatch[0].maxMatchString.indexOf(fullCategory) > -1) {
					isEdgeCase = true;
				}
			}
		}
		if (queObEnt_Bra.fullMatch) {
			if (queObEnt_Bra.fullMatch[1]) {
				if (queObEnt_Bra.fullMatch.length > 0 && queObEnt_Bra.fullMatch[0].maxMatchString.indexOf(partialCategory) > -1) {
					isEdgeCase = true;
				}
			}
		}

		// 3. Prevent if gender brand matched
		if (queObEnt_Gen.fullMatch) {
			if (queObEnt_Gen.fullMatch.length > 0 && queObEnt_Gen.fullMatch[0].matchedEntity.indexOf(partialCategory) > -1) {
				isEdgeCase = true;
			}
		}
	} catch (e) {
		Logger.log("PartialCategoryEdgeCaseException for " + queryObjectEntities.query + " / " + partialCategory + " : " + e + ". " + e.stack);
		Logger.log(" ");
	}

	return isEdgeCase;
};


/////////////////////////////////////////////////
//
// 2.4. MATCH TITLES
//
/////////////////////////////////////////////////

/*
 * @param {string} query
 * @param {array} queryObjectEntities
 * @return {object} queryObjectEntities
 */
QueryToEntityMatcher.prototype.extractFullTitles = function(query, queryObjectEntities) {

	for (var j = 0; j < this.entitiesObject.titles.length; j++) {

		if (queryObjectEntities.overallMatchValue == 1) continue;

		var titleInBetween = " " + this.entitiesObject.titles[j] + " ";
		var titleAtEnd = " " + this.entitiesObject.titles[j];
		var titleAtBeginning = this.entitiesObject.titles[j] + " ";

		if (query == this.entitiesObject.titles[j] || this.entitiesObject.titles[j].length > 2 && query.indexOf(titleInBetween) > -1 || query.indexOf(titleAtBeginning) == 0 || (query.indexOf(titleAtEnd) != -1 && query.indexOf(titleAtEnd) == (query.length - titleAtEnd.length))) {

			if (this.exitIfFullTitleEdgeCase(queryObjectEntities, this.entitiesObject.titles[j]) === true) continue;
			if (!queryObjectEntities.titles.fullMatch) {
				queryObjectEntities.titles.fullMatch = [{
					"maxMatchValue": 0.0,
					"maxMatchString": ""
				}];
			}

			var newEntry = {
				"matchedEntity": this.entitiesObject.titles[j],
				"matchValue": Math.round(this.entitiesObject.titles[j].replace(/ /g, "").length / queryObjectEntities.query.replace(/ /g, "").length * 100) / 100
			};

			if (newEntry.matchValue > queryObjectEntities.titles.fullMatch[0].maxMatchValue) {
				queryObjectEntities.titles.fullMatch.push(newEntry);
				queryObjectEntities.titles.fullMatch[0].maxMatchValue = newEntry.matchValue;
				queryObjectEntities.titles.fullMatch[0].maxMatchString = newEntry.matchedEntity;
			} // if match value higher
		}
	} // END for Titles

	if (queryObjectEntities.titles.fullMatch) {
		query = query.replace(queryObjectEntities.titles.fullMatch[0].maxMatchString, "");

		queryObjectEntities._overallMatchValue += queryObjectEntities.titles.fullMatch[0].maxMatchValue;
		queryObjectEntities._overallMatchedLetters += queryObjectEntities.titles.fullMatch[0].maxMatchString.length;
	}

	return {
		queryObjectEntities: queryObjectEntities,
		query: query
	};
};


/*
 * @param {array} queryObjectEntities
 * @param {string} fullTitle
 * @return {bool} isEdgeCase
 * @throws {exception} FullTitleEdgeCaseException 
 */
QueryToEntityMatcher.prototype.exitIfFullTitleEdgeCase = function(queryObjectEntities, fullTitle) {
	var isEdgeCase = false;

	var queObEnt_Bra = queryObjectEntities.brand;
	var queObEnt_Cat = queryObjectEntities.category;

	try {
		// Collection of EDGE CASES
		// 1. Prevent full title match, if fully brand matched
		if (queObEnt_Bra.fullMatch) {
			if (queObEnt_Bra.fullMatch.length > 1 && queObEnt_Bra.fullMatch[0].maxMatchString.indexOf(fullTitle) > -1) {
				isEdgeCase = true;
			}
		}

		// 2. Prevent full title match, if fully category matched
		if (queObEnt_Cat.fullMatch) {
			if (queObEnt_Cat.fullMatch.length > 1 && queObEnt_Cat.fullMatch[0].maxMatchString.indexOf(fullTitle) > -1) {
				isEdgeCase = true;
			}
		}

		// 3. Prevent full title match, if partial category matched
		if (queObEnt_Cat.partialMatches && queObEnt_Cat.partialMatches.length > 1) {
			if (queObEnt_Cat.partialMatches[queObEnt_Cat.partialMatches.length - 1].matchedEntity.indexOf(fullTitle) > -1) {
				isEdgeCase = true;
			}
		}
	} catch (e) {
		Logger.log("FullTitleEdgeCaseException for : " + queryObjectEntities.query + " / " + fullTitle + " : " + e + ". " + e.stack);
		Logger.log(" ");
	}

	return isEdgeCase;
};


/*
 * @param {string} query
 * @param {array} queryObjectEntities
 * @return {object} queryObjectEntities
 */
QueryToEntityMatcher.prototype.extractPartialTitles = function(query, queryObjectEntities) {

	for (var j = 0; j < this.entitiesObject.titles.length; j++) {

		if (queryObjectEntities.overallMatchValue == 1) continue;

		var tokenizedTitleString = this.entitiesObject.titles[j].split(" ");

		for (var k = 0; k < tokenizedTitleString.length; k++) {
			if (tokenizedTitleString[k].length >= 3 && query.indexOf(tokenizedTitleString[k]) > -1 && !queryObjectEntities.titles.fullMatch) {

				if (this.exitIfPartialTitleEdgeCase(queryObjectEntities, this.entitiesObject.titles[j], tokenizedTitleString[k]) === true) continue;
				if (!queryObjectEntities.titles.partialMatches) queryObjectEntities.titles.partialMatches = [{
					"maxMatchValue": 0.0,
					"maxMatchString": ""
				}];

				var partialString = tokenizedTitleString[k];

				// Try extending partial match to two wordbackmatch
				if (tokenizedTitleString[k - 1]) {
					var twoWordBackMatch = tokenizedTitleString[k - 1] + " " + tokenizedTitleString[k];
					if (query.indexOf(twoWordBackMatch) > -1) partialString = twoWordBackMatch;
				}

				// Try extending partial match to twoWordForwardMatch
				if (tokenizedTitleString[k + 1]) {
					var twoWordForwardMatch = tokenizedTitleString[k] + " " + tokenizedTitleString[k + 1];
					if (query.indexOf(twoWordForwardMatch) > -1) partialString = twoWordForwardMatch;
				}

				// Try extending partial match to threeWordBackMatch
				if (tokenizedTitleString[k - 2] && tokenizedTitleString[k - 1]) {
					var threeWordBackMatch = tokenizedTitleString[k - 2] + " " + tokenizedTitleString[k - 1] + " " + tokenizedTitleString[k];
					if (query.indexOf(threeWordBackMatch) > -1) partialString = threeWordBackMatch;
				}

				// Try extending partial match to threeWordWrapMatch
				if (tokenizedTitleString[k - 1] && tokenizedTitleString[k + 1]) {
					var threeWordWrapMatch = tokenizedTitleString[k - 1] + " " + tokenizedTitleString[k] + " " + tokenizedTitleString[k + 1];
					if (query.indexOf(threeWordWrapMatch) > -1) partialString = threeWordWrapMatch;
				}

				// Try extending partial match to threewordForwardmatch
				if (tokenizedTitleString[k + 1] && tokenizedTitleString[k + 2]) {
					var threeWordForwardMatch = tokenizedTitleString[k] + " " + tokenizedTitleString[k + 1] + " " + tokenizedTitleString[k + 2];
					if (query.indexOf(threeWordForwardMatch) > -1) partialString = threeWordForwardMatch;
				}

				var newEntry = {
					"matchedEntity": this.entitiesObject.titles[j],
					"matchString": partialString,
					"matchValue": Math.round(partialString.replace(/ /g, "").length / queryObjectEntities.query.replace(/ /g, "").length * 100) / 100
				};

				query = query.replace(this.entitiesObject.titles[j], "");


				if (newEntry.matchString.length > 3 && newEntry.matchValue > queryObjectEntities.titles.partialMatches[0].maxMatchValue &&
					newEntry.matchValue != queryObjectEntities.titles.partialMatches[queryObjectEntities.titles.partialMatches.length - 1].maxMatchString) {
					queryObjectEntities.titles.partialMatches.push(newEntry);
					queryObjectEntities.titles.partialMatches[0].maxMatchValue = newEntry.matchValue;
					queryObjectEntities.titles.partialMatches[0].maxMatchString = newEntry.matchString;
				}
			}
		} // END for loop title tokenized
	}
	if (queryObjectEntities.titles.partialMatches) {
		queryObjectEntities._overallMatchValue += queryObjectEntities.titles.partialMatches[0].maxMatchValue;
		queryObjectEntities._overallMatchedLetters += queryObjectEntities.titles.partialMatches[0].maxMatchString.length;
	}

	return {
		queryObjectEntities: queryObjectEntities,
		query: query
	};
};


/*
 * @param {array} queryObjectEntities
 * @param {string} fullTitle
 * @param {string} partialString
 * @return {bool} isEdgeCase
 * @throws {exception} PartialTitleEdgeCaseException
 */
QueryToEntityMatcher.prototype.exitIfPartialTitleEdgeCase = function(queryObjectEntities, fullTitle, partialString) {

	var isEdgeCase = false;

	var queObEnt_Bra = queryObjectEntities.brand;
	var queObEnt_Cat = queryObjectEntities.category;
	var queObEnt_Gen = queryObjectEntities.gender;

	try {
		// Collection of EDGE CASES
		// 1. Prevent gender match from full or partial title
		if (queObEnt_Gen.fullMatch) {
			if (queObEnt_Gen.fullMatch.length > 0 && queObEnt_Gen.fullMatch[0].matchedEntity == fullTitle) {
				isEdgeCase = true;
			}
			if (queObEnt_Gen.fullMatch.length > 0 && queObEnt_Gen.fullMatch[0].matchedEntity == partialString) {
				isEdgeCase = true;
			}
		}

		// 2. Prevent partial title match, if fully category matched
		if (queObEnt_Cat.fullMatch) {
			if (queObEnt_Cat.fullMatch.length > 1 && queObEnt_Cat.fullMatch[0].maxMatchString.indexOf(partialString) > -1) {
				isEdgeCase = true;
			}
		}

		// 3. Prevent partial title match, if partially category matched
		if (queObEnt_Cat.partialMatches && queObEnt_Cat.partialMatches.length > 1) {
			if (queObEnt_Cat.partialMatches[queObEnt_Cat.partialMatches.length - 1].matchedEntity.indexOf(partialString) > -1) {
				isEdgeCase = true;
			}
		}

		// 4. Prevent partial title match, if fully brand matched
		if (queObEnt_Bra.fullMatch) {
			if (queObEnt_Bra.fullMatch.length > 1 && queObEnt_Bra.fullMatch[0].maxMatchString.indexOf(partialString) > -1) {
				isEdgeCase = true;
			}
		}

		// 5. Prevent partial title match, if partially brand matched
		if (queObEnt_Bra.partialMatches && queObEnt_Bra.partialMatches.length > 1) {
			if (queObEnt_Bra.partialMatches[queObEnt_Bra.partialMatches.length - 1].matchedEntity.indexOf(partialString) > -1) {
				isEdgeCase = true;
			}
		}

		// 6. Prevent partial title match, if fully gender matched
		if (queObEnt_Gen.fullMatch) {
			if (queObEnt_Gen.fullMatch.length > 0 && queObEnt_Gen.fullMatch[0].matchedEntity.indexOf(partialString) > -1) {
				isEdgeCase = true;
			}
		}
	} catch (e) {
		Logger.log("PartialTitleEdgeCaseException for " + queryObjectEntities.query + " / " + partialString + " : " + e + ". " + e.stack);
		Logger.log(" ");
	}

	return isEdgeCase;
};


/*
 * @param {string} query
 * @param {array} queryObjectEntities
 * @return {object} queryObjectEntities
 */

QueryToEntityMatcher.prototype.getKeywordSuggestions = function(query, queryObjectEntities) {

	var keyword_WithPluses = queryObjectEntities.query.replace(/ /g, "+").replace(/_/g, "+");
	var requestUrl = "https://suggestqueries.google.com/complete/search?output=chrome&hl=de&q=" + keyword_WithPluses;
	var response = JSON.parse(UrlFetchApp.fetch(requestUrl, {
		muteHttpExceptions: true
	}));
	var keywordSuggestions = [];

	if (typeof response[1][0] != "undefined") {
		for (var j = 0; j < 3; j++) {
			if (j === 0 || response[4]["google:suggestrelevance"][j - 1] - response[4]["google:suggestrelevance"][j] < 10) {

				var levChanges = this.getLevenshteinChanges(response[0].toLowerCase(), response[1][j]);
				var levDistance = (1 - levChanges / response[1][j].length).toFixed(2);
				var suggestionObject = {
					"keyword": response[1][j],
					"wordSimilarity": levDistance
				};
				if (levDistance > 0.84 && levChanges < 3) keywordSuggestions.push(suggestionObject);

				if (DEBUG_MODE === 1) Logger.log(">>>>> getKeywordSuggestions for " + queryObjectEntities.query + " : " + response[1][j] + " | gSuggestRelevance : " + response[4]["google:suggestrelevance"][j] + " | charChangesToOriginal : " + levChanges + " | matchValue : " + levDistance);
			}
		} // END FOR j suggestions
	}
	if (keywordSuggestions.length > 0) queryObjectEntities.keywordSuggestions = keywordSuggestions;

	return {
		queryObjectEntities: queryObjectEntities,
		query: query
	};

};


/*
 * NOT IMPLEMENTED !!!
 * @param {array} queryObjectEntities
 * @return {float} overallMatchValue
 */
QueryToEntityMatcher.prototype.getOverallMatchValue = function(queryObjectEntities) {};

/*
 * @param {string} a, the original string
 * @param {string} b, the reference string
 * @return {int} res, the number of changes
 */
QueryToEntityMatcher.prototype.getLevenshteinChanges = function(a, b) {
	var tmp;
	if (a.length === 0) {
		return b.length;
	}
	if (b.length === 0) {
		return a.length;
	}
	if (a.length > b.length) {
		tmp = a;
		a = b;
		b = tmp;
	}

	var i, j, res, alen = a.length,
		blen = b.length,
		row = Array(alen);
	for (i = 0; i <= alen; i++) {
		row[i] = i;
	}

	for (i = 1; i <= blen; i++) {
		res = i;
		for (j = 1; j <= alen; j++) {
			tmp = row[j - 1];
			row[j - 1] = res;
			res = b[i - 1] === a[j - 1] ? tmp : Math.min(tmp + 1, Math.min(res + 1, row[j] + 1));
		}
	}
	return res;
};


/////////////////////////////////////////////////
//
// 2.5. MATCH COLOR
//
/////////////////////////////////////////////////


/*
 * @param {string} query
 * @param {array} queryObjectEntities
 * @return {object} queryObjectEntities
 */
QueryToEntityMatcher.prototype.extractColor = function(query, queryObjectEntities) {

	for (var j = 0; j < this.entitiesObject.colors.length; j++) {
		if (query.indexOf(this.entitiesObject.colors[j]) > -1 && this.entitiesObject.colors[j].length > 2) {
			queryObjectEntities.colors.fullMatch = [{
				"matchedEntity": this.entitiesObject.colors[j],
				"matchValue": Math.round(this.entitiesObject.colors[j].replace(/ /g, "").length / queryObjectEntities.query.replace(/ /g, "").length * 100) / 100,
				"maxMatchString": this.entitiesObject.colors[j],
				"maxMatchValue": 1
			}];
			query = query.replace(this.entitiesObject.colors[j], "");

			queryObjectEntities._overallMatchValue += queryObjectEntities.colors.fullMatch[0].matchValue;
			queryObjectEntities._overallMatchedLetters += queryObjectEntities.colors.fullMatch[0].matchedEntity.length;
		}
	}
	return {
		queryObjectEntities: queryObjectEntities,
		query: query
	};
};

QueryToEntityMatcher.prototype.extractSize = function(query, queryObjectEntities) {

	for (var j = 0; j < this.entitiesObject.sizes.length; j++) {

		var size = this.entitiesObject.sizes[j];
		var sizeInBetween = " " + size + " ";
		var sizeAtEnd = " " + size;

		if (query.indexOf(sizeInBetween) > -1 || (query.indexOf(sizeAtEnd) != -1 && query.indexOf(sizeAtEnd) == (query.length - sizeAtEnd.length))) {

			// if(DEBUG_MODE === 1) { Logger.log("size in between: "+sizeInBetween); Logger.log("size at end: "+sizeAtEnd); Logger.log("query index sizeInBetween greater than -1: "+(query.indexOf(sizeInBetween) > -1)); Logger.log("query index sizeAtEnd does not equal -1: "+(query.indexOf(sizeAtEnd) != -1)); Logger.log("query index sizeAtEnd: "+query.indexOf(sizeAtEnd)); Logger.log("query index sizeAtEnd equals query length minus sizeAtEnd length: "+(query.indexOf(sizeAtEnd) == (query.length -  sizeAtEnd.length))); Logger.log("query length minus sizeAtEnd length: "+(query.length - sizeAtEnd.length)); }

			queryObjectEntities.sizes.fullMatch = [{
				"matchedEntity": this.entitiesObject.sizes[j],
				"matchValue": Math.round(this.entitiesObject.sizes[j].replace(/ /g, "").length / queryObjectEntities.query.replace(/ /g, "").length * 100) / 100,
				"maxMatchString": this.entitiesObject.sizes[j],
				"maxMatchValue": 1
			}];

			query = query.replace(this.entitiesObject.sizes[j], "");

			queryObjectEntities._overallMatchValue += queryObjectEntities.sizes.fullMatch[0].matchValue;
			queryObjectEntities._overallMatchedLetters += queryObjectEntities.sizes.fullMatch[0].matchedEntity.length;
		}
	}
	return {
		queryObjectEntities: queryObjectEntities,
		query: query
	};
};

QueryToEntityMatcher.prototype.extractCustomAttribute = function(query, queryObjectEntities, attribute) {

	for (var j = 0; j < this.entitiesObject.custom_attributes[attribute].length; j++) {
		var current_entity = this.entitiesObject.custom_attributes[attribute][j];
		if (query.indexOf(current_entity) > -1) {
			queryObjectEntities.custom_attributes[attribute] = {};
			queryObjectEntities.custom_attributes[attribute].fullMatch = [{
				"matchedEntity": current_entity,
				"matchValue": Math.round(current_entity.replace(/ /g, "").length / queryObjectEntities.query.replace(/ /g, "").length * 100) / 100,
				"maxMatchString": current_entity,
				"maxMatchValue": 1
			}];

			query = query.replace(this.entitiesObject.custom_attributes[attribute][j], "");
			queryObjectEntities._overallMatchValue += queryObjectEntities.custom_attributes[attribute].fullMatch[0].matchValue;
			queryObjectEntities._overallMatchedLetters += queryObjectEntities.custom_attributes[attribute].fullMatch[0].matchedEntity.length;
		}
	}
	return {
		queryObjectEntities: queryObjectEntities,
		query: query
	};
};



/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////////////////////////////////////////// 
//
// 2. PARENT_ENTITY_ENHANCER @prototype
//
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////   

function ParentEntityEnhancer() {

}

/*
 * @param {object} entityMatches
 * @param {object} entityDataFetcher
 * @return {object} enhancedEntityMatches
 */
ParentEntityEnhancer.prototype.addBrandsAndCategories = function(entityMatches, entityDataFetcher) {

	var enhancedEntityMatches = entityMatches;

	for (var i = 1; i < enhancedEntityMatches.length; i++) {

		if (!enhancedEntityMatches[i].titles) continue;

		// Add brand value by title lookup 
		if (enhancedEntityMatches[i].titles.fullMatch && enhancedEntityMatches[i].brand) {
			if (!enhancedEntityMatches[i].brand.fullMatch) {
				enhancedEntityMatches[i].brand.fullMatch = [{}];
				var title = enhancedEntityMatches[i].titles.fullMatch[0].maxMatchString;
				var enhancedBrand = entityDataFetcher.getBrandByTitle(title);
				enhancedEntityMatches[i].brand.fullMatch[0].maxMatchString = enhancedBrand;
				enhancedEntityMatches[i].brand.fullMatch[0].parentEnhancedType = "feedLookup";
			}
		}
		if (enhancedEntityMatches[i].titles.fullMatch && !enhancedEntityMatches[i].brand) {
			enhancedEntityMatches[i].brand = {};
			enhancedEntityMatches[i].brand.fullMatch = [{}];
			var title = enhancedEntityMatches[i].titles.fullMatch[0].maxMatchString;
			var enhancedBrand = entityDataFetcher.getBrandByTitle(title);
			enhancedEntityMatches[i].brand.fullMatch[0].maxMatchString = enhancedBrand;
			enhancedEntityMatches[i].brand.fullMatch[0].parentEnhancedType = "feedLookup";
		}

		// Add brand value by shopping ADGROUP lookup
		if (enhancedEntityMatches[i].brand) {
			if (!enhancedEntityMatches[i].brand.fullMatch && STRUCTURE_IDENTIFIER.shopping.adgroup === "brand" && enhancedEntityMatches[i].querySource.keywordTextMatchingQuery.indexOf("==") != -1) {
				enhancedEntityMatches[i].brand.fullMatch = [{}];
				enhancedEntityMatches[i].brand.fullMatch[0].maxMatchString = enhancedEntityMatches[i].querySource.adgroup;
				enhancedEntityMatches[i].brand.fullMatch[0].parentEnhancedType = "shoppingAdgroupLookup";
			}
		}
		if (!enhancedEntityMatches[i].brand) {
			if (STRUCTURE_IDENTIFIER.shopping.adgroup == "brand" && keywordTextMatchingQuery.indexOf("==") != -1) {
				enhancedEntityMatches[i].brand.fullMatch = [{}];
				enhancedEntityMatches[i].brand.fullMatch[0].maxMatchString = enhancedEntityMatches[i].querySource.adgroup;
				enhancedEntityMatches[i].brand.fullMatch[0].parentEnhancedType = "shoppingAdgroupLookup";
			}
		}

		// Add brand value by shopping CAMPAIGN lookup >> 
		/*if (enhancedEntityMatches[i].brand && typeof STRUCTURE_IDENTIFIER.shopping.campaign != "undefined") {
				if (!enhancedEntityMatches[i].brand.fullMatch && STRUCTURE_IDENTIFIER.shopping.campaign === "brand" && enhancedEntityMatches[i].querySource.keywordTextMatchingQuery.indexOf("==") != -1) {
					enhancedEntityMatches[i].brand.fullMatch = [{}];
					enhancedEntityMatches[i].brand.fullMatch[0].maxMatchString = enhancedEntityMatches[i].querySource.adgroup;
					enhancedEntityMatches[i].brand.fullMatch[0].parentEnhancedType = "shoppingAdgroupLookup";
				}
		}
		if (!enhancedEntityMatches[i].brand && typeof STRUCTURE_IDENTIFIER.shopping.adgroup != "undefined") {
			if (STRUCTURE_IDENTIFIER.shopping.adgroup == "brand" && keywordTextMatchingQuery.indexOf("==") != -1) {
				enhancedEntityMatches[i].brand.fullMatch = [{}];
				enhancedEntityMatches[i].brand.fullMatch[0].maxMatchString = enhancedEntityMatches[i].querySource.adgroup;
				enhancedEntityMatches[i].brand.fullMatch[0].parentEnhancedType = "shoppingAdgroupLookup";
			}
		}*/


		// Add brand value by shopping product_group_tree lookup
		if (enhancedEntityMatches[i].brand) {
			if (!enhancedEntityMatches[i].brand.fullMatch && STRUCTURE_IDENTIFIER.shopping.product_group_tree.indexOf("brand") != -1 && enhancedEntityMatches[i].querySource.keywordTextMatchingQuery.indexOf("==") != -1) {
				enhancedEntityMatches[i].brand.fullMatch = [{}];

				var brandValue = enhancedEntityMatches[i].querySource.keywordTextMatchingQuery.split("brand==")[1].split("&")[0];
				enhancedEntityMatches[i].brand.fullMatch[0].maxMatchString = brandValue;
				enhancedEntityMatches[i].brand.fullMatch[0].parentEnhancedType = "shoppingTreeLookup";
			}
		}
		if (!enhancedEntityMatches[i].brand) {
			if (STRUCTURE_IDENTIFIER.shopping.product_group_tree.indexOf("brand") != -1 && enhancedEntityMatches[i].querySource.keywordTextMatchingQuery.indexOf("==") != -1) {
				enhancedEntityMatches[i].brand.fullMatch = [{}];

				var brandValue = enhancedEntityMatches[i].querySource.keywordTextMatchingQuery.split("brand==")[1].split("&")[0];
				enhancedEntityMatches[i].brand.fullMatch[0].maxMatchString = brandValue;
				enhancedEntityMatches[i].brand.fullMatch[0].parentEnhancedType = "shoppingTreeLookup";
			}
		}


		// Add category value by title lookup
		if (enhancedEntityMatches[i].titles.fullMatch && enhancedEntityMatches[i].category) {
			if (!enhancedEntityMatches[i].category.fullMatch) {
				enhancedEntityMatches[i].category.fullMatch = [{}];
				var title = enhancedEntityMatches[i].titles.fullMatch[0].maxMatchString;
				var enhancedCategory = entityDataFetcher.getLowestCategoryByTitle(title);
				enhancedEntityMatches[i].category.fullMatch[0].maxMatchString = enhancedCategory;
				enhancedEntityMatches[i].category.fullMatch[0].parentEnhancedType = "feedLookup";
			}
		}
		if (enhancedEntityMatches[i].titles.fullMatch && !enhancedEntityMatches[i].categories) {
			enhancedEntityMatches[i].category = {};
			enhancedEntityMatches[i].category.fullMatch = [{}];
			var title = enhancedEntityMatches[i].titles.fullMatch[0].maxMatchString;
			enhancedEntityMatches[i].category.fullMatch[0].maxMatchString = entityDataFetcher.getLowestCategoryByTitle(title);
			enhancedEntityMatches[i].category.fullMatch[0].parentEnhancedType = "feedLookup";
		}


		// Add category value by shopping product_group_tree lookup
		if (enhancedEntityMatches[i].category) {
			if (!enhancedEntityMatches[i].category.fullMatch && STRUCTURE_IDENTIFIER.shopping.product_group_tree.indexOf("category") != -1 && enhancedEntityMatches[i].querySource.keywordTextMatchingQuery.indexOf("==") != -1) {
				enhancedEntityMatches[i].category.fullMatch = [{}];

				var categoryValue = "";
				if (categoryValue.length === 0 && enhancedEntityMatches[i].querySource.keywordTextMatchingQuery.indexOf("product_type_l3") != -1) {
					categoryValue = enhancedEntityMatches[i].querySource.keywordTextMatchingQuery.split("product_type_l3==")[1].split("&")[0];
				}
				if (categoryValue.length === 0 && enhancedEntityMatches[i].querySource.keywordTextMatchingQuery.indexOf("product_type_l2") != -1) {
					categoryValue = enhancedEntityMatches[i].querySource.keywordTextMatchingQuery.split("product_type_l2==")[1].split("&")[0];
				}
				if (categoryValue.length === 0 && enhancedEntityMatches[i].querySource.keywordTextMatchingQuery.indexOf("product_type_l1") != -1) {
					categoryValue = enhancedEntityMatches[i].querySource.keywordTextMatchingQuery.split("product_type_l1==")[1].split("&")[0];
				}

				enhancedEntityMatches[i].category.fullMatch[0].maxMatchString = categoryValue;
				enhancedEntityMatches[i].category.fullMatch[0].parentEnhancedType = "shoppingTreeLookup";
			}
		}

		if (!enhancedEntityMatches[i].category) {
			if (STRUCTURE_IDENTIFIER.shopping.product_group_tree.indexOf("category") != -1 && enhancedEntityMatches[i].querySource.keywordTextMatchingQuery.indexOf("==") != -1) {
				enhancedEntityMatches[i].category.fullMatch = [{}];

				var categoryValue = "";
				if (categoryValue.length === 0 && enhancedEntityMatches[i].querySource.keywordTextMatchingQuery.indexOf("product_type_l3") != -1) {
					categoryValue = enhancedEntityMatches[i].querySource.keywordTextMatchingQuery.split("product_type_l3==")[1].split("&")[0];
				}
				if (categoryValue.length === 0 && enhancedEntityMatches[i].querySource.keywordTextMatchingQuery.indexOf("product_type_l2") != -1) {
					categoryValue = enhancedEntityMatches[i].querySource.keywordTextMatchingQuery.split("product_type_l2==")[1].split("&")[0];
				}
				if (categoryValue.length === 0 && enhancedEntityMatches[i].querySource.keywordTextMatchingQuery.indexOf("product_type_l1") != -1) {
					categoryValue = enhancedEntityMatches[i].querySource.keywordTextMatchingQuery.split("product_type_l1==")[1].split("&")[0];
				}

				enhancedEntityMatches[i].category.fullMatch[0].maxMatchString = categoryValue;
				enhancedEntityMatches[i].category.fullMatch[0].parentEnhancedType = "shoppingTreeLookup";
			}
		}

		// Add category value by shopping agroup lookup
		if (enhancedEntityMatches[i].category) {
			if (!enhancedEntityMatches[i].category.fullMatch && STRUCTURE_IDENTIFIER.shopping.adgroup === "category" && enhancedEntityMatches[i].querySource.keywordTextMatchingQuery.indexOf("==") != -1) {
				enhancedEntityMatches[i].category.fullMatch = [{}];
				enhancedEntityMatches[i].category.fullMatch[0].maxMatchString = enhancedEntityMatches[i].querySource.adgroup;
				enhancedEntityMatches[i].category.fullMatch[0].parentEnhancedType = "shoppingAdgroupLookup";
			}
		}
		if (!enhancedEntityMatches[i].category) {
			if (STRUCTURE_IDENTIFIER.shopping.adgroup == "category" && enhancedEntityMatches[i].querySource.keywordTextMatchingQuery.indexOf("==") != -1) {
				enhancedEntityMatches[i].category.fullMatch = [{}];
				enhancedEntityMatches[i].category.fullMatch[0].maxMatchString = enhancedEntityMatches[i].querySource.adgroup;
				enhancedEntityMatches[i].category.fullMatch[0].parentEnhancedType = "shoppingAdgroupLookup";
			}
		}


	} // END FOR LOOP
	Logger.log("enhancedEntityMatches Summary: " + JSON.stringify(enhancedEntityMatches[0]));
	return enhancedEntityMatches;
};

// Functions to add other attributes from feed tbd size, color, gender

ParentEntityEnhancer.prototype.addColors = function(entityMatches, entityDataFetcher) {

	for (var i = 1; i < entityMatches.length; i++) {
		if (!entityMatches[i].titles) {
			continue;
		}
		if (enhancedEntityMatches[i].titles.fullMatch && enhancedEntityMatches[i].colors) {
			if (!enhancedEntityMatches[i].colors.fullMatch) {
				enhancedEntityMatches[i].colors.fullMatch = [{}];
				var title = enhancedEntityMatches[i].titles.fullMatch[0].maxMatchString;
				var enhancedColor = entityDataFetcher.getColorByTitle(title);
				enhancedEntityMatches[i].colors.fullMatch[0].maxMatchString = enhancedColor;
				enhancedEntityMatches[i].colors.fullMatch[0].parentEnhancedType = "feedLookup";
			}
		}
		if (enhancedEntityMatches[i].titles.fullMatch && !enhancedEntityMatches[i].colors) {
			enhancedEntityMatches[i].colors = {};
			enhancedEntityMatches[i].colors.fullMatch = [{}];
			var title = enhancedEntityMatches[i].titles.fullMatch[0].maxMatchString;
			var enhancedColor = entityDataFetcher.getColorByTitle(title);
			enhancedEntityMatches[i].colors.fullMatch[0].maxMatchString = enhancedColor;
			enhancedEntityMatches[i].colors.fullMatch[0].parentEnhancedType = "feedLookup";
		}
	}
};


/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////////////////////////////////////////// 
//
// 3. MATCHED_STRUCTURE_ENHANCER @prototype
//
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////   

function MatchedStructureEnhancer(entityMatches) {
	this.entityMatches = entityMatches;

}

/*
 * @param {object} entityMatches
 * @return {object} entityMatchesWithStructure
 */
MatchedStructureEnhancer.prototype.addStructureMatches = function() {

	var baseEntityMatches = this.entityMatches;
	var entityMatchesWithStructure = [];

	for (var i = 1; i < baseEntityMatches.length; i++) {
		var entityMatch_c = this.matchCampaigns(baseEntityMatches[i]);
		var entityMatch_ca = this.matchAdGroups(entityMatch_c);

		entityMatchesWithStructure.push(entityMatch_ca);
	}

	return entityMatchesWithStructure;
};



/*
 * @param {object} singleEntityMatch
 * @return {object} enhancedEntityMatches
 */
MatchedStructureEnhancer.prototype.matchCampaigns = function(singleEntityMatch) {

	var targetEnhancedEntityMatch = singleEntityMatch;
	if (!targetEnhancedEntityMatch.target) {
		targetEnhancedEntityMatch.target = {
			"campaign": {}
		};
	} else {
		targetEnhancedEntityMatch.target.campaign = {};
	}

	// FULL BRAND
	if (singleEntityMatch.brand && STRUCTURE_IDENTIFIER.brand.level.toLowerCase() == "campaign") {
		if (singleEntityMatch.brand.fullMatch) {
			targetEnhancedEntityMatch.target.campaign.matches = this.matchCampaignsByType("brand", singleEntityMatch);

			// if(targetEnhancedEntityMatch.target.campaign.matches[0].maxMatchValue === 0) targetEnhancedEntityMatch.target.campaign.matches = this.matchCampaignsByLabel(singleEntityMatch, STRUCTURE_IDENTIFIER.brand.labels);
		}
	}

	// PARTIAL BRAND: Find campaign matches from partial match values
	/*if (singleEntityMatch.brand && STRUCTURE_IDENTIFIER.brand.level.toLowerCase() == "campaign" && targetEnhancedEntityMatch.target.campaign.matches.length === 0) {
	  if (singleEntityMatch.brand.partialMatches) {
	    targetEnhancedEntityMatch.target.campaign.partialMatches = this.matchCampaignsByType("brand", singleEntityMatch);

	    // if(targetEnhancedEntityMatch.target.campaign.matches[0].maxMatchValue === 0) targetEnhancedEntityMatch.target.campaign.matches = this.matchCampaignsByLabel(singleEntityMatch, STRUCTURE_IDENTIFIER.brand.labels);
	  }
	}*/

	if (singleEntityMatch.category && STRUCTURE_IDENTIFIER.category.level.toLowerCase() == "campaign" && !singleEntityMatch.brand) {
		if (singleEntityMatch.category.fullMatch) {
			targetEnhancedEntityMatch.target.campaign.matches = this.matchCampaignsByType("category", singleEntityMatch);

			// if(targetEnhancedEntityMatch.target.campaign.matches[0].maxMatchValue === 0) this.matchCampaignsByLabel(singleEntityMatch, STRUCTURE_IDENTIFIER.category.labels);
		}
	}
	return targetEnhancedEntityMatch;
};

/*
 * @param {string} sourceEntityType
 * @param {object} singleEntityMatch
 * @return {object} enhancedEntityMatches
 */
MatchedStructureEnhancer.prototype.matchCampaignsByType = function(sourceEntityType, singleEntityMatch) {

	var entityMatchValue = singleEntityMatch[sourceEntityType].fullMatch;
	var sourceEntityPrefix = STRUCTURE_IDENTIFIER[sourceEntityType].optionalPrefix;
	var matches = [{
		"maxMatchValue": 0.0,
		"maxMatchString": ""
	}];

	if (typeof entityMatchValue[0].maxMatchString !== "undefined") {
		if (STRUCTURE_IDENTIFIER.extraCampaign.allInOneCampaign === "YES" || entityMatchValue[0].maxMatchString.length < 3) {
			matches = [{
				"maxMatchValue": 1,
				"maxMatchString": STRUCTURE_IDENTIFIER.extraCampaign.campaignName
			}];
			return matches;
		}
	}


	try {
		var campaignIterator = AdWordsApp.campaigns()
			.withCondition('Name CONTAINS_IGNORE_CASE "' + sourceEntityPrefix + '"')
			.withCondition('Name CONTAINS_IGNORE_CASE "' + entityMatchValue[0].maxMatchString + '"')
			.withCondition('Name DOES_NOT_CONTAIN_IGNORE_CASE "' + STRUCTURE_IDENTIFIER.shopping.campaignIdentifier + '"')
			.get();

		while (campaignIterator.hasNext()) {
			var campaign = campaignIterator.next();
			var matchedString = sourceEntityPrefix + entityMatchValue[0].maxMatchString;

			// Skip clone campaigns
			for (var i = 0; i < CLONECAMP_IDENTIFIER.length; i++) {
				if (campaign.getName().indexOf(CLONECAMP_IDENTIFIER[i]) != -1) continue;
			}

			var newEntry = {
				"matchedEntity": campaign.getName(),
				"matchedString": matchedString,
				"matchValue": Math.round(matchedString.replace(/ /g, "").length / campaign.getName().replace(/ /g, "").length * 100) / 100
			};
			matches.push(newEntry);
			if (newEntry.matchValue > matches[0].maxMatchValue) {
				matches[0].maxMatchValue = newEntry.matchValue;
				matches[0].maxMatchString = newEntry.matchedEntity;
			}
		} // END WHILE Loop

	} catch (e) {
		Logger.log(e);
	}

	// if no campaign is found reset matches to a plain array, so that maxMatchString isn't found
	if (matches.length < 2) {
		matches = [];
	}

	return matches;
};


/*
 * @param {object} entityMatches
 * @param {object} entityDataFetcher
 * @return {object} enhancedEntityMatches
 */
MatchedStructureEnhancer.prototype.matchCampaignsByLabel = function(entityMatches, entityDataFetcher) {};


/*
 * @param {object} singleEntityMatch
 * @return {object} enhancedEntityMatches
 */
MatchedStructureEnhancer.prototype.matchAdGroups = function(singleEntityMatch) {

	var targetEnhancedEntityMatch = singleEntityMatch;
	if (!targetEnhancedEntityMatch.target) {
		targetEnhancedEntityMatch.target = {
			"adgroup": {}
		};
	} else {
		targetEnhancedEntityMatch.target.adgroup = {};
	}

	if (singleEntityMatch.brand && STRUCTURE_IDENTIFIER.brand.level.toLowerCase() == "adgroup") {
		if (singleEntityMatch.brand.fullMatch && targetEnhancedEntityMatch.target.campaign.maxMatchValue > 0) {
			targetEnhancedEntityMatch.target.adgroup.matches = this.matchAdGroupsByType("brand", singleEntityMatch, targetEnhancedEntityMatch.target.campaign.maxMatchString);

			// if(targetEnhancedEntityMatch.adgroup.campaign.matches[0].maxMatchValue === 0) targetEnhancedEntityMatch.target.adgroup.matches = this.matchAdGroupsByLabel(singleEntityMatch, STRUCTURE_IDENTIFIER.brand.labels);
		}
	}

	if (singleEntityMatch.category && STRUCTURE_IDENTIFIER.category.level.toLowerCase() == "adgroup") {
		if (singleEntityMatch.category.fullMatch && targetEnhancedEntityMatch.target.campaign.maxMatchValue > 0) {
			targetEnhancedEntityMatch.target.adgroup.matches = this.matchAdGroupsByType("category", singleEntityMatch, targetEnhancedEntityMatch.target.campaign.maxMatchString);

			// if(targetEnhancedEntityMatch.target.campaign.matches[0].maxMatchValue === 0) this.matchAdGroupByLabel(singleEntityMatch, STRUCTURE_IDENTIFIER.category.labels);
		}
	}
	targetEnhancedEntityMatch.target.adgroup.fallback = this.addFallBackAdgroup(singleEntityMatch);

	return targetEnhancedEntityMatch;
};

/*
 * @param {object} entityMatches
 * @param {object} entityDataFetcher
 * @return {object} enhancedEntityMatches
 */
MatchedStructureEnhancer.prototype.matchAdGroupsByType = function(sourceEntityType, singleEntityMatch, campaignName) {

	var entityMatchValue = singleEntityMatch[sourceEntityType].fullMatch[0].maxMatchString;
	var sourceEntityPrefix = STRUCTURE_IDENTIFIER[sourceEntityType].optionalPrefix;

	var matches = [{
		"maxMatchValue": 0.0,
		"maxMatchString": ""
	}];

	try {
		var adGroupIterator = AdWordsApp.adGroups()
			.withCondition('Name CONTAINS_IGNORE_CASE "' + sourceEntityPrefix + '"')
			.withCondition('Name CONTAINS_IGNORE_CASE "' + entityMatchValue + '"')
			.withCondition('CampaignName CONTAINS_IGNORE_CASE "' + campaignName + '"')
			.get();

		while (adGroupIterator.hasNext()) {
			var adGroup = adGroupIterator.next();
			var matchedString = sourceEntityPrefix + entityMatchValue;

			var newEntry = {
				"matchedEntity": adGroup.getName(),
				"matchedString": matchedString,
				"matchValue": Math.round(matchedString.replace(/ /g, "").length / adGroup.getName().replace(/ /g, "").length * 100) / 100
			};

			if (newEntry.matchValue > matches[0].maxMatchValue) {
				matches.push(newEntry);
				matches[0].maxMatchValue = newEntry.matchValue;
				matches[0].maxMatchString = newEntry.matchedEntity;
			}
		} // END WHILE Loop

	} catch (e) {
		Logger.log(e);
	}

	// if no adgroup is found reset matches to a plain array, so that maxMatchString isn't found
	if (matches.length < 2) matches = [];

	return matches;
};


/*
 * @param {object} entityMatches
 * @param {object} entityDataFetcher
 * @return {object} enhancedEntityMatches
 */
MatchedStructureEnhancer.prototype.matchAdGroupByLabel = function(entityMatches, entityDataFetcher) {};


MatchedStructureEnhancer.prototype.addFallBackAdgroup = function(singleEntityMatch) {

	var entityHierarchy = this.getEntityHierarchy();
	var fallBackAdgroupName = STRUCTURE_IDENTIFIER.newadgroups.newAdgroupPrefix;

	for (var i = 0; i < entityHierarchy.length; i++) {

		if (singleEntityMatch[entityHierarchy[i]]) {
			if (singleEntityMatch[entityHierarchy[i]].fullMatch && !singleEntityMatch[entityHierarchy[i]].fullMatch[0].parentEnhancedType) {
				fallBackAdgroupName += entityHierarchy[i].charAt(0).toUpperCase().replace("T", "M");

				if (entityHierarchy[i] == "category" && singleEntityMatch.query.indexOf(singleEntityMatch[entityHierarchy[i]].fullMatch[0].maxMatchString) == -1) {
					fallBackAdgroupName.replace("C", "");
				}
				if (entityHierarchy[i] == "brand" && singleEntityMatch.query.indexOf(singleEntityMatch[entityHierarchy[i]].fullMatch[0].maxMatchString) == -1) {
					var brandPrefix = singleEntityMatch[entityHierarchy[i]].fullMatch[0].maxMatchString;
				}
				// Implementation for adgroup build by hierarchy
				// if(STRUCTURE_IDENTIFIER[entityHierarchy[i]].level == "campaign" && STRUCTURE_IDENTIFIER.extraCampaign.allInOneCampaign === "NO") continue;
				// fallBackAdgroupName += STRUCTURE_IDENTIFIER[entityHierarchy[i]].optionalPrefix + singleEntityMatch[entityHierarchy[i]].fullMatch[0].maxMatchString;
				// if(i != entityHierarchy.length-1) fallBackAdgroupName += STRUCTURE_IDENTIFIER.adgroupSeparator; 
			}
			if (singleEntityMatch[entityHierarchy[i]].partialMatches && !singleEntityMatch[entityHierarchy[i]].fullMatch) {
				fallBackAdgroupName += entityHierarchy[i].charAt(0).toUpperCase().replace("T", "M");

				// Implementation for adgroup build by hierarchy
				// if(STRUCTURE_IDENTIFIER[entityHierarchy[i]].level == "campaign" && STRUCTURE_IDENTIFIER.extraCampaign.allInOneCampaign === "NO" && singleEntityMatch[entityHierarchy[i]].partialMatches[0].maxMatchString.length < 4) continue; 
				// fallBackAdgroupName += STRUCTURE_IDENTIFIER[entityHierarchy[i]].optionalPrefix + singleEntityMatch[entityHierarchy[i]].partialMatches[0].maxMatchString;
				// if(i != entityHierarchy.length-1) fallBackAdgroupName += STRUCTURE_IDENTIFIER.newadgroups.adgroupSeparator; 
			}
		}
	} // END Entity Hierachy Loop FallbackName

	fallBackAdgroupName += "_";
	if (brandPrefix) fallBackAdgroupName += brandPrefix + " ";
	fallBackAdgroupName += singleEntityMatch.query;

	if (typeof STRUCTURE_IDENTIFIER.newadgroups.newAdgroupSuffix != "undefined") fallBackAdgroupName += STRUCTURE_IDENTIFIER.newadgroups.newAdgroupSuffix;
	return fallBackAdgroupName;
};


MatchedStructureEnhancer.prototype.getEntityHierarchy = function() {

	var entityHierarchy = [];
	for (var prop in STRUCTURE_IDENTIFIER) {
		if (prop == "shopping" || prop == "adgroupSeparator" || prop == "extraCampaign" ||  prop == "newAdgroups") continue;
		entityHierarchy.splice(STRUCTURE_IDENTIFIER[prop].hierarchy - 1, 0, prop);
	}
	return entityHierarchy;
};



/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////////////////////////////////////////// 
//
// 4. INSTOCK_CHECKER @prototype
//
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

/**
 * Checks if a given search query has search results
 * @param {Array} entities All the entities to be checked. Expects a complete entities array
 */
function InStockChecker(entities) {
	var config_check_query = INSTOCK_CHECKER_CONFIG.config_check_query;
	this.minSearchResults = INSTOCK_CHECKER_CONFIG.minSearchResults;
	this.outOfStockStrings = INSTOCK_CHECKER_CONFIG.outOfStockStrings;
	this.searchUrlPrefix = INSTOCK_CHECKER_CONFIG.searchUrlPrefix;
	this.resultCountElement = INSTOCK_CHECKER_CONFIG.resultCountElement;
	this.checkForSearchResults = typeof INSTOCK_CHECKER_CONFIG.checkFor_SearchResults != "undefined" ? INSTOCK_CHECKER_CONFIG.checkFor_SearchResults : 1;
	this.entities = entities;

	if (!config_check_query) throw new Error("INSTOCK_CHECKER_CONFIG.config_check_query is not defined. InStockChecker can't validate the extraction methods.");

	var test_query_object = this.checkQueryHasSearchResults(config_check_query);
	Logger.log("Test search for query '" + config_check_query + "' : " + JSON.stringify(test_query_object) + "\n");

	if (test_query_object.results === 0) throw new Error("Please provide a short standard query like 'schuhe', 'hemd' in order to run the InStockChecker validation. Example: INSTOCK_CHECKER_CONFIG.config_check_query = 'schuhe';");
}

/*
 * param {string} query
 * return {object} searchResultObject
 */
InStockChecker.prototype.checkQueryHasSearchResults = function(query) {
	var searchResultCount;
	var url = this.searchUrlPrefix.concat(query);
	var temp_object = {
		"queryHasSearchResults": false,
		"results": "0"
	};

	try {
		var content = UrlFetchApp.fetch(url, {
			muteHttpExceptions: true
		}).getContentText().toLowerCase();

		for (var i = 0; i < this.outOfStockStrings.length; i++) {
			if (content.indexOf(this.outOfStockStrings[i].toLowerCase()) > -1) return temp_object;
		}
		temp_object.queryHasSearchResults = true;

		// Only check search result page for result count if specified in config. Otherwise set 1 as a default number.
		if (this.checkForSearchResults === 1) temp_object.results = this.getSearchResultCount(content);
		else {
			temp_object.results = 1;
		}

		return temp_object;
	} catch (e) {
		Logger.log("UrlFetchError for " + url);
		Logger.log(e.stack);
		Logger.log(e);
		return temp_object;
	}
};

InStockChecker.prototype.getSearchResultCount = function(content) {
	try {
		content = content.split(this.resultCountElement.textBefore)[1];
		content = content.split(this.resultCountElement.textAfter)[0];
		content = parseInt(content);
	} catch (e) {
		throw new Error("InStockCheckerError: getSearchResults didn't return a number as result count. Please check your search result extraction pre- & suffixes in the INSTOCK_CHECKER_CONFIG.");
	}
	return content;
};

InStockChecker.prototype.addInStockInfo = function() {
	for (var i = 0; i < this.entities.length; i++) {
		var entity = this.entities[i];
		var query = entity.query;
		var result = this.checkQueryHasSearchResults(query);
		entity.inStock = {};
		entity.inStock.queryHasSearchResults = result.queryHasSearchResults;
		entity.inStock.results = result.results;
	}
};


/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////////////////////////////////////////// 
//
// 5. ADGROUP_OBJECT_CONVERTER @prototype
//
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////


/**
 * [AdGroupObjectConverter description]
 * @param {Array} entityMatches [description]
 */
function AdGroupObjectConverter(entityMatches) {
	this.entityMatches = entityMatches;
	this.minThresholdMap = {
		"strict": 0.9,
		"standard": 0.7,
		"open": 0.5
	};
}



/**
 * [getAdGroupObjects description]
 * @return {Array} [description]
 */
AdGroupObjectConverter.prototype.getAdGroupObjects = function() {
	var inStockActive = typeof INSTOCK_CHECKER_CONFIG.active != "undefined" ? INSTOCK_CHECKER_CONFIG.active : 0;
	var checkInStock = typeof INSTOCK_CHECKER_CONFIG.checkFor_SearchResults != "undefined" ? INSTOCK_CHECKER_CONFIG.checkFor_SearchResults : 0;

	if (typeof NEW_PAID_QUERY_CONFIG.queryInclude_TermSimilarity == "undefined") {
		throw new Error("NEW_PAID_QUERY_CONFIG.queryInclude_TermSimilarity is not defined. Please define a specific term similarity mode.\n" +
			"You can choose from one of the following modes with corresponding minimum similarity values:\n" +
			"strict: " + this.minThresholdMap.strict + " > This number tells us that " + this.minThresholdMap.strict * 100 + "% of a query need to be matched to known entities in your AdWords account and feed.\n" +
			"standard: " + this.minThresholdMap.standard + "\n" +
			"open: " + this.minThresholdMap.open + "\n");
	}
	// get configured threshold mode
	var minThresholdMode = NEW_PAID_QUERY_CONFIG.queryInclude_TermSimilarity;

	// get the float value threshold corresponding to the configured mode. If mode is not open, standard or strict, throw an exception
	var minThreshold = this.minThresholdMap[minThresholdMode] ? this.minThresholdMap[minThresholdMode] : "undefined";
	if (minThreshold == "undefined") {
		throw new Error("NEW_PAID_QUERY_CONFIG.queryInclude_TermSimilarity mode '" + NEW_PAID_QUERY_CONFIG.queryInclude_TermSimilarity + "' is not supported. " +
			"You can choose from one of the following modes with corresponding minimum similarity values:\n" +
			"strict: " + this.minThresholdMap.strict + " > This number tells us, that " + this.minThresholdMap.strict * 100 + "% of a query need to be matched to known entities in your AdWords account and feed.\n" +
			"standard: " + this.minThresholdMap.standard + "\n" +
			"open: " +  this.minThresholdMap.open + "\n");
	}

	Logger.log("TermSimilarity mode is '%s'. Min similarity value is %s. This number indicates that %s percent of a query need to be matched to known entities in your AdWords account and/or feed.", minThresholdMode, minThreshold, minThreshold * 100);
	Logger.log(" ");
	var adGroupObjects = [];
	var skippedEntries_Stock = {
		"inStock_Skips": 0,
		"inStock_Skips_Terms": []
	};
	var skippedEntries_MatchValue = {
		"minValue_Skips": 0,
		"minValue_Skips_Terms": []
	};
	var skippedEntries_UrlLookup = {
		"urlLookup_Skips": 0,
		"urlLookup_Skips_Terms": []
	};


	// Allowinng for two types of url lookup: direct via Google scrape
	// Danach Initialisierung eines entsprechenden Datahandlers
	var dataHandler;
	if (typeof URL_LOOKUP_CONFIG !== "undefined") {
		if (URL_LOOKUP_CONFIG.type == "Data4Seo") {

			// var lookUp_StorageHandler = new UrlLookupStorageHandler();
			var lookUp_StorageHandler = new SpreadsheetHandler();
			dataHandler = new Data4SeoHandler(lookUp_StorageHandler);

			// load task ids of which the result hasn't been retrieved from the data4seo API
			var taskIds = lookUp_StorageHandler.loadUnFinishedTaskIds();

			// retrieve data from api and store it inside the results property of the Data4SeoHandler
			dataHandler.getTaskResults(taskIds);
		} else  { dataHandler = new StaticUrlExtractor(URL_LOOKUP_CONFIG.se_name); }
	}


	for (var i = 0; i < this.entityMatches.length; i++) {
		var entMatch = this.entityMatches[i];

		// exclude queries which don't have search results when INSTOCK_CHECKER_CONFIG.checkFor_SearchResults is active
		if (inStockActive === 1 && checkInStock === 1 && !entMatch.inStock.queryHasSearchResults) {
			skippedEntries_Stock.inStock_Skips++;
			if (skippedEntries_Stock.inStock_Skips_Terms.indexOf(entMatch.query) === -1) skippedEntries_Stock.inStock_Skips_Terms.push(entMatch.query);
			continue;
		}

		// skip entity match if correponding _overallMatchValue is below the defined threshold
		if (entMatch._overallMatchValue < minThreshold) {
			skippedEntries_MatchValue.minValue_Skips++;
			if (skippedEntries_MatchValue.minValue_Skips_Terms.indexOf(entMatch.query) === -1) skippedEntries_MatchValue.minValue_Skips_Terms.push(entMatch.query);
			continue;
		}

		var adGroupObject = {};

		adGroupObject.adGroup = this.getAdGroup(entMatch);
		adGroupObject.campaign = this.getCampaign(entMatch);
		adGroupObject.headline = this.getHeadline(entMatch.query);
		adGroupObject.kwWithUnderscore = this.getKeyword(entMatch); // TBD
		adGroupObject.aggregationType = this.getAggregationType(entMatch);
		adGroupObject.brand = this.getByFullMatch("brand", entMatch);
		adGroupObject.category = this.getByFullMatch("category", entMatch);
		adGroupObject.gender = this.getByFullMatch("gender", entMatch);
		adGroupObject.discount = 0;
		adGroupObject.minPrice = 0;
		adGroupObject.saleItems = 0;
		adGroupObject.querySource = entMatch.querySource;
		adGroupObject.urlSuffix = this.getUrlSuffix(entMatch, dataHandler);
		adGroupObject.matchAccuracy = this.getMatchAccuracy(entMatch);

		// Skip if urlBuild via lookup and response pending
		if (typeof URL_LOOKUP_CONFIG != "undefined") {
			if (URL_LOOKUP_CONFIG.active === true && adGroupObject.urlSuffix.length === 0) {
				skippedEntries_UrlLookup.urlLookup_Skips++;
				skippedEntries_UrlLookup.urlLookup_Skips_Terms.push(this.getKeyword(entMatch));
				continue;
			}
		}

		adGroupObjects.push(adGroupObject);
	} // END FOR i: entityMatches
	
	if (typeof URL_LOOKUP_CONFIG != "undefined") {
		if (URL_LOOKUP_CONFIG.type == "Data4Seo") dataHandler.createNewTasks(skippedEntries_UrlLookup.urlLookup_Skips_Terms);
	}

	Logger.log("Skipped entries by InStockCheck  : " + JSON.stringify(skippedEntries_Stock));
	Logger.log("Skipped entries by MinMatchValue : " + JSON.stringify(skippedEntries_MatchValue));
	if (skippedEntries_UrlLookup.urlLookup_Skips.length > 0) Logger.log("Skipped entries by UrlLookup : " + JSON.stringify(skippedEntries_UrlLookup));
	Logger.log(" ");

	return adGroupObjects;
};

/**
 * [getAdGroup description]
 * @param  {[type]} entityMatch [description]
 * @return {[type]}             [description]
 */
AdGroupObjectConverter.prototype.getAdGroup = function(entityMatch) {
	var adGroup = "";

	if (entityMatch.target.adgroup.matches && entityMatch.target.adgroup.matches.length > 0) {
		if (entityMatch.target.adgroup.matches[0].maxMatchValue > 0.9) {
			adGroup = entityMatch.target.adgroup.matches[0].maxMatchString;
		} else {
			adGroup = entityMatch.target.adgroup.fallback;
		}
	} else {
		adGroup = entityMatch.target.adgroup.fallback;
	}
	return adGroup;
};

/**
 * [getCampaign description]
 * @param  {[type]} entityMatch [description]
 * @return {[type]}             [description]
 */
AdGroupObjectConverter.prototype.getCampaign = function(entityMatch) {
	var campaign = "";

	if (entityMatch.target.campaign.matches && entityMatch.target.campaign.matches.length > 0) {
		if (entityMatch.target.campaign.matches[0].maxMatchValue > 0.7) {
			campaign = entityMatch.target.campaign.matches[0].maxMatchString;
		} else campaign = STRUCTURE_IDENTIFIER.extraCampaign.campaignName;
	} else campaign = STRUCTURE_IDENTIFIER.extraCampaign.campaignName;

	return campaign;
};


/**
 * [getHeadline description]
 * @param  {[type]} string [description]
 * @return {[type]}        [description]
 */
AdGroupObjectConverter.prototype.getHeadline = function(string) {
	var headline = "";

	// MISSING: UpperCaseFirstNormalization
	var stringArray = string.split(" ");
	var normalizedString = [];

	for (var i = 0; i < stringArray.length; i++) {
		var singleNormalizedString = stringArray[i].toLowerCase().replace(/^[a-züäö]/g, function(f) {
			return f.toUpperCase();
		});
		normalizedString.push(singleNormalizedString);
	}

	var ucFirstString = normalizedString.join(" ");

	return ucFirstString;

};

AdGroupObjectConverter.prototype.getKeyword = function(entityMatch) {
	
	var temp_keyword = entityMatch.query;
	var temp_array = temp_keyword.split(" ");
	var finalArray = [];

	for(var i = 0; i < temp_array.length; i++){
		var element = temp_array[i];
		if(element.length > 15 && element.indexOf("-") > -1){
			element = element.replace("-","_");
		}
		finalArray.push(element);
	}

	return finalArray.join(" ");
};


AdGroupObjectConverter.prototype.getUrlSuffix = function(entityMatch, dataHandler) {
	var cleanedSuffix = entityMatch.query;
	if (entityMatch.custom_attributes) {
		for (var attribute in entityMatch.custom_attributes) {
			var matchedString = entityMatch.custom_attributes[attribute].fullMatch.maxMatchString;
			cleanedSuffix = cleanedSuffix.replace(matchedString, "");
		}
	}

	cleanedSuffix = cleanedSuffix.replace(/ /g, "+");

	// Overwrite value if URL lookup active
	if (typeof URL_LOOKUP_CONFIG != "undefined") {
		if (URL_LOOKUP_CONFIG.active === true) {
			var result = this.getUrl_ByLookup(entityMatch.query, dataHandler);
			//if(result){
			cleanedSuffix = result;
			//} 
		}
	}

	return cleanedSuffix;
};

AdGroupObjectConverter.prototype.getUrl_ByLookup = function(queryString, dataHandler) {

	var fullUrl = "";

	var url = dataHandler.getStaticUrl(queryString).url.toLowerCase();

	var similarityValue = dataHandler.getStaticUrl(queryString).similarityValue;

	if (url.length > 0 && similarityValue > 0.05 && url.indexOf(URL_LOOKUP_CONFIG.site) != -1){
	  if(typeof URL_SCHEMA != "undefined" && url.indexOf(URL_SCHEMA.urlPrefix) > -1){
		url = url.replace(URL_SCHEMA.urlPrefix,"");
	  }
	  fullUrl = url;
	}

	// use queries to print static url and related searches to screen
	if (DEBUG_MODE === 1) {
		Logger.log("Query: 'site:" + URL_LOOKUP_CONFIG.site + " " + queryString + "'");
		Logger.log("Static URL: " + JSON.stringify(dataHandler.getStaticUrl(queryString)));
		Logger.log("Related Searches: " + JSON.stringify(dataHandler.getRelatedSearches(queryString)));
		Logger.log("#####\n");
	}

	return fullUrl;
};

/**
 * [getAggregationType description]
 * @param  {[type]} entityMatch [description]
 * @return {[type]}             [description]
 */
AdGroupObjectConverter.prototype.getAggregationType = function(entityMatch) {
	var aggregationType = "";
	aggregationType = entityMatch.target.adgroup.fallback.replace(STRUCTURE_IDENTIFIER.newadgroups.newAdgroupPrefix, "").split("_")[0];
	if (aggregationType.length === 0) {
		aggregationType = "default";
	}
	return aggregationType;
};


/**
 * [getByFullMatch description]
 * @param  {[type]} entityType  [description]
 * @param  {[type]} entityMatch [description]
 * @return {[type]}             [description]
 */
AdGroupObjectConverter.prototype.getByFullMatch = function(entityType, entityMatch) {
	var extractedEntity = "";
	if (entityMatch[entityType]) {
		if (entityMatch[entityType].fullMatch) extractedEntity = entityMatch[entityType].fullMatch[0].maxMatchString;
	}
	return extractedEntity;
};


AdGroupObjectConverter.prototype.getMatchAccuracy = function(entityMatch) {
	var matchAccuracy = Math.round(entityMatch._overallMatchValue * 10) / 10;
	return matchAccuracy;
};


/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////////////////////////////////////////// 
//
// 6. DATA4SEO_HANDLER @prototype
//
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////



/**
 * Data4SeoHandler Object
 * @param {UrlLookupStorageHandler} storageHandler Handler that manages the BigQuery API.
 */

function Data4SeoHandler(storageHandler) {
	this.results = {};
	this.storageHandler = storageHandler;

	// this.data = {}; // new object that stores 
}

/**
 * Submit new queries to API 
 * @param  {Array} queries Array that contains strings representing new queries. If queries already exist in the database, they won't be submitted.
 */
Data4SeoHandler.prototype.createNewTasks = function(queries) {

	// fetch existing queries
	/*
	var query = this.storageHandler.buildSelectQuery_(["query"]);	
	var temp_existingQueries = this.storageHandler.queryDataTable_(query); // get all queries from DB
	*/

	var temp_existingQueries = this.storageHandler.getExistingQueries();
	var existingQueries = {};

	Logger.log("Queries to be checked: "+JSON.stringify(queries));
	Logger.log("Existing queries: "+JSON.stringify(temp_existingQueries));

	for (var j = 0; j < temp_existingQueries.length; j++) {
		if (!existingQueries[temp_existingQueries[j][0]]) {
			existingQueries[temp_existingQueries[j][0]] = temp_existingQueries[j][0];
		}
	}

	

	for (var k = 0; k < queries.length; k++) {
		query = queries[k];
		if (existingQueries[query]) {
			queries.splice(k, 1);
			k--;
		}
	}

	Logger.log("New queries: "+JSON.stringify(queries));

	if (queries.length === 0) {
		Logger.log("No new queries to be submitted to D4S API.");
		return;
	}
	Logger.log("Submitting new tasks to API."); Logger.log("Queries: " + JSON.stringify(queries));

	var data = { data: {} };

	// Creating Data4SEO data objects per query
	for (var i = 0; i < queries.length; i++) {
		query = URL_LOOKUP_CONFIG.site + ' ' + queries[i]; // removed "site:"+ to skip higer credit cost
		var object = {
			'priority': '1',
			'site': URL_LOOKUP_CONFIG.site,
			'se_name': URL_LOOKUP_CONFIG.se_name,
			'se_language': URL_LOOKUP_CONFIG.se_language,
			'loc_name_canonical': URL_LOOKUP_CONFIG.loc_name_canonical,
			'key': query
		};
		data.data[query] = object;
	} // END For queries

	var options = {
		'method': 'post',
		'contentType': 'application/json',
		'headers': {'Authorization': AUTH_HEADER},
		'muteHttpExceptions': true,
		'payload': JSON.stringify(data)
	};

	var response = JSON.parse(UrlFetchApp.fetch(API_SET_URL, options));

	for (var result in response.results) {
		var site_string = URL_LOOKUP_CONFIG.site + " "; // removed "site:"+ to skip higer credit cost
		var sanitizedQuery = response.results[result].post_key.replace(site_string, "");
		this.storageHandler.pushDataToCache(response.results[result].task_id, sanitizedQuery);
	}

	if (this.storageHandler.cache.length > 0) this.storageHandler.flush();
};

/**
 * retrieves the static URL by query
 * @param  {string} query 
 * @return {object}       returns an object. The url property contains a string with the extracted url. The similarityValue property contains a float representing the similarity value of query and retrieved url.
 */
Data4SeoHandler.prototype.getStaticUrl = function(query) {
	
	/* var db_query = this.storageHandler.buildSelectQuery_(["url","similarityValue"], [{inputField: "query", operator: "=", value: query}]);
	var results = this.storageHandler.queryDataTable_(db_query);
	*/

	var results = this.storageHandler.getUrlAndSimValueForQuery(query);
	if (results.length === 0) return { url: "", similarityValue: 0 };
	var url = results[0][0];
	var simValue = results[0][1];

	return { url: url, similarityValue: simValue };
};

/*
* @param {string} query
* @param {string} url 
* @return {float} simValue
*/
Data4SeoHandler.prototype.calculateSimilarityValue = function(query, url) {
	if (!url || !query) return 0;
	var match;
	var regex = /^h?t?t?p?s?\:?\/?\/?www\.[\w|\d|\-|\_]*\.\w*\/(.*)$/gi;

	match = url.split(URL_LOOKUP_CONFIG.site + "/")[1];

	if (typeof(match) == "undefined" || !match) return 0;

	var validatedUrl = match.replace(/\//g, " ");
	validatedUrl = validatedUrl.replace(/^\s/, "").replace(/\s$/, "").replace(/_/g," ");
	validatedUrl = validatedUrl.split("-").join(" ");
	validatedUrl = validatedUrl.replace(URL_LOOKUP_CONFIG.brand_name, "").split(" ").sort().join(" ");

	query = query.split("-").join(" ");
	query = query.replace(URL_LOOKUP_CONFIG.brand_name + " ", "").split(" ").sort().join(" ");
	Logger.log("strippedQuery :" + query + " | url-slug : " + validatedUrl);

	var wordDistance = this._calculateLetterChanges(validatedUrl, query);
	var simValue = (1 - wordDistance / validatedUrl.length).toFixed(2);

	return simValue;
};

/**
 * retrieves the related searches by query
 * @param  {string} query String that contains the query
 * @return {object}       returns an object that contains the related searches as array, the intersection_value and the intersection_word
 */
Data4SeoHandler.prototype.getRelatedSearches = function(query) {
	/*
  var db_query = this.storageHandler.buildSelectQuery_(["relatedSearches"], [{
    inputField: "query",
    operator: "=",
    value: query
  }]);

  var relatedSearches = this.storageHandler.queryDataTable_(db_query);*/

	var relatedSearches = this.storageHandler.getRelatedSearchesForQuery(query);
	if (relatedSearches.length === 0) {
		return {
			relatedSearches: [],
			intersection_word: "",
			intersection_value: 0
		};
	}
	return {
		relatedSearches: relatedSearches[0][0].split(","),
		intersection_word: this._computeWordIntersection(relatedSearches[0][0].split(",")).total.max_intersect_word,
		intersection_value: this._computeWordIntersection(relatedSearches[0][0].split(",")).total.max_intersect_value
	};
};

/**
 * Method that retrieves the results of a data 4 seo api and stores it in BigQuery
 * @param  {array} taskIds 
 */
Data4SeoHandler.prototype.getTaskResults = function(taskIds) {

	this.taskIds = taskIds;
	var options = {
		'method': 'get',
		'contentType': 'application/json',
		'headers': {'Authorization': AUTH_HEADER},
		'muteHttpExceptions': true,
	};
	// var results = [];

	for (var i = 0; i < taskIds.length; i++) {
		var taskId = taskIds[i];

		var fetch_target = API_GET_URL.charAt(API_GET_URL.length - 1) == "/" ? API_GET_URL : API_GET_URL + "/";
		fetch_target += taskId; // @TODO: Why increment? 
		var result = JSON.parse(UrlFetchApp.fetch(fetch_target, options));
		var url, relatedSearches;
		var query = result.results.organic[0].post_key.replace(URL_LOOKUP_CONFIG.site, "");

		try {
			var bestUrl = {"simValue" : 0, "url": ""};

			for (var j = 0; j < 3; j++) {
				url = result.results.organic[j].result_url;
				var resultRootDomain = url.replace("https://","").replace("www.//","");

				// Get simValue if url contains domain AND is not home
				if (url.indexOf(URL_LOOKUP_CONFIG.site) != -1 && URL_LOOKUP_CONFIG.site !== resultRootDomain) {
					var similarityValue = this.calculateSimilarityValue(query, url);
					if(similarityValue > bestUrl.simValue) {
						bestUrl.url = url;
						bestUrl.simValue = similarityValue;
					}
				}
			} // END For loop	j = url results

		relatedSearches = typeof result.results.extra.related !== "undefined" && typeof result.results.extra.related[j] !== "undefined" ? result.results.extra.related[j].join() : relatedSearches = "";

		this.storageHandler.setStatusDone(taskId, bestUrl.url, relatedSearches, bestUrl.simValue);
		this.results[taskId] = result;

		} catch (e) { Logger.log("TaskResultException: Task not finished or no url found. Error:" + e); }
	} // END FOR loop taskIds
};

/**
 * computes the intersection of an array of strings
 * @param  {array} array array containing the strings to be computed
 * @return {object}       
 * object = { total: { max_intersect_word: "", max_intersect_value: 0, word_count: 0 }, combinations: {}};
 */
Data4SeoHandler.prototype._computeWordIntersection = function(array) {
	var object = {
		total: {
			max_intersect_word: "",
			max_intersect_value: 0,
			word_count: 0
		},
		combinations: {}
	};
	for (var i = 0; i < array.length; i++) {
		var value_array = array[i].split(" ");
		value_array = this._getCombinations(value_array);

		for (var j = 0; j < value_array.length; j++) {
			var value = value_array[j];
			if (object.combinations[value]) {
				continue;
			}
			object.combinations[value] = {
				hit_count: 0,
				inbetween_count: 0,
				inbeginning_count: 0,
				atend_count: 0,
				word_count: value.split(" ").length
			};
			for (var k = 0; k < array.length; k++) {
				if (array[k].match(new RegExp(".*" + value + ".*", "g"))) {
					object.combinations[value].hit_count++;
				}
				if (array[k].match(new RegExp(".*\\s" + value + "\\s.*", "g"))) {
					object.combinations[value].inbetween_count++;
				}
				if (array[k].match(new RegExp("^" + value + "\\s.*", "g"))) {
					object.combinations[value].inbeginning_count++;
				}
				if (array[k].match(new RegExp(".*\\s" + value + "$", "g"))) {
					object.combinations[value].atend_count++;
				}
			}
			object.combinations[value].appearing_index = object.combinations[value].hit_count / array.length;
			object.combinations[value].appearing_fullWord_index = (object.combinations[value].inbetween_count + object.combinations[value].inbeginning_count + object.combinations[value].atend_count) / array.length;

			if (object.combinations[value].appearing_fullWord_index > object.total.max_intersect_value) {
				object.total.max_intersect_value = object.combinations[value].appearing_fullWord_index;
				object.total.max_intersect_word = value;
				object.total.word_count = object.combinations[value].word_count;
			} else if (object.combinations[value].appearing_fullWord_index == object.total.max_intersect_value && object.combinations[value].word_count > object.total.word_count) {
				object.total.max_intersect_value = object.combinations[value].appearing_fullWord_index;
				object.total.max_intersect_word = value;
				object.total.word_count = object.combinations[value].word_count;
			}
		}

	}
	return object;
};

/**
 * generates combinations of characters
 * @param  {array} chars strings
 * @return {array}       combinations
 */
Data4SeoHandler.prototype._getCombinations = function(chars) {
	var result = [];
	var f = function(prefix, chars) {
		for (var i = 0; i < chars.length; i++) {
			result.push(prefix + chars[i]);
			f(prefix + chars[i] + " ", chars.slice(i + 1));
		}
	};
	f('', chars);
	return result;
};

/**
 * calculate letter changes between to words
 * @param  {string} a first word
 * @param  {string} b second word
 * @return {number}  
 */
Data4SeoHandler.prototype._calculateLetterChanges = function(a, b) {
	var tmp;
	if (a.length === 0) {
		return b.length;
	}
	if (b.length === 0) {
		return a.length;
	}
	if (a.length > b.length) {
		tmp = a;
		a = b;
		b = tmp;
	}

	var i, j, res, alen = a.length,
		blen = b.length,
		row = Array(alen);
	for (i = 0; i <= alen; i++) {
		row[i] = i;
	}

	for (i = 1; i <= blen; i++) {
		res = i;
		for (j = 1; j <= alen; j++) {
			tmp = row[j - 1];
			row[j - 1] = res;
			res = b[i - 1] === a[j - 1] ? tmp : Math.min(tmp + 1, Math.min(res + 1, row[j] + 1));
		}
	}
	return res;
};

/**
 * @constructor SpreadsheetHandler
 */
function SpreadsheetHandler() {
	var spreadsheet_id = AD_SPREADSHEET_ID;
	var sheetName = "(urls)";
	this.timeStamp = this.getTimeStamp();
	this.cache = [];

	try {
		this.controlSpreadsheet = SpreadsheetApp.openById(AD_SPREADSHEET_ID).getSheetByName(sheetName);
	} catch (e) {
		SpreadsheetApp.openById(AD_SPREADSHEET_ID).insertSheet(sheetName);
		try{
			this.controlSpreadsheet = SpreadsheetApp.openById(AD_SPREADSHEET_ID).getSheetByName(sheetName);
		} catch (e2) {
			throw new Error("SheetNotFoundException: Please add the sheet '(urls)' to your ad template. This is needed for storing url lookup data. error: " + e2 + ". stack : " + e2.stack);
		}
	}
}


SpreadsheetHandler.prototype.pushDataToCache = function(task_id, query) {
	this.cache.push([task_id, query]);
};

SpreadsheetHandler.prototype.flush = function() {
	Logger.log(JSON.stringify(this.cache));
	for (var i = 0; i < this.cache.length; i++) {
		try {
			this.controlSpreadsheet.appendRow([this.cache[i][0], this.cache[i][1], "", "no", "", "", ""]);
		} catch (e) {
			throw new Error("Error appending new row to spreadsheet. " + e.stack);
		}
	}
	this.cache = [];
};


/**
 * function that loads values from a spreadsheet
 * @return {Array}
 */
SpreadsheetHandler.prototype.loadUnFinishedTaskIds = function() {
	var existingValues = [];
	existingValues = this.controlSpreadsheet.getRange("A2:F" + this.controlSpreadsheet.getLastRow()).getValues();
	var finalArray = [];

	for (var i = 0; i < existingValues.length; i++) {
		// TBD set exact index of status
		if (existingValues[i][3] == "no") {
			finalArray.push(existingValues[i][0]);
		}
	}
	return finalArray;
};


SpreadsheetHandler.prototype.setStatusDone = function(task_id, url, relatedSearches, similarityValue) {
	var existingIds = this.controlSpreadsheet.getRange("A2:A" + this.controlSpreadsheet.getLastRow()).getValues();
	var rowIndex = existingIds.findIndex(findIndexCallback, task_id) + 2;

	if (rowIndex < 2) return;

	this.controlSpreadsheet.getRange(rowIndex, 3).setValue(url);
	this.controlSpreadsheet.getRange(rowIndex, 5).setValue(relatedSearches);
	this.controlSpreadsheet.getRange(rowIndex, 4).setValue("yes");
	this.controlSpreadsheet.getRange(rowIndex, 6).setValue(similarityValue);
	this.controlSpreadsheet.getRange(rowIndex, 7).setValue(this.timeStamp);

};

SpreadsheetHandler.prototype.getExistingQueries = function() {
	return this.controlSpreadsheet.getRange("B2:B" + this.controlSpreadsheet.getLastRow()).getValues();
};

SpreadsheetHandler.prototype.getUrlAndSimValueForQuery = function(query) {
	var existingQueries = this.controlSpreadsheet.getRange("B2:B" + this.controlSpreadsheet.getLastRow()).getValues();
	var rowIndex = existingQueries.findIndex(findIndexCallback, query) + 2;
	if (rowIndex < 2) return [];
	
	return [[this.controlSpreadsheet.getRange(rowIndex, 3).getValue(), this.controlSpreadsheet.getRange(rowIndex, 6).getValue()]];
};

SpreadsheetHandler.prototype.getRelatedSearchesForQuery = function(query) {
	var existingQueries = this.controlSpreadsheet.getRange("B2:B" + this.controlSpreadsheet.getLastRow()).getValues();
	var rowIndex = existingQueries.findIndex(findIndexCallback, query) + 2;

	if (rowIndex < 2) return [];

	return [[this.controlSpreadsheet.getRange(rowIndex, 5).getValue()]];
};

function findIndexCallback(element) {
	return element[0] == this;
}

/*
* @return string dateTime
*/
SpreadsheetHandler.prototype.getTimeStamp = function() {
   
  var currentdate = new Date();
  var currrentHourGmc = currentdate.getUTCHours()+1;
  
  var dateTime =
		(currentdate.getDate() < 10 ? '0' + currentdate.getDate().toString() : currentdate.getDate()) + "." +
		(currentdate.getMonth()+1) + "." +
		currentdate.getFullYear() + " , "  +
		currrentHourGmc + ":"  +
		(currentdate.getMinutes() < 10 ? '0' + currentdate.getMinutes().toString() : currentdate.getMinutes());
   
  return dateTime;  // target format = '24.2.2017 , 12:09'
};


/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////////////////////////////////////////// 
//
// 7. URL_LOOKUP_STORAGE_HANDLER @prototype
//
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

/**
 * @constructor BigQueryUrlLookupStorageHandler
 * @param {String} entityType entity type of the data to be handled
 */


function UrlLookupStorageHandler() {
	if (typeof SCRIPT_NAME == "undefined") {
		throw "Exception: SCRIPT_NAME not defined. This variable is needed for BigQuery access. Please configure or consult your script support.";
	}
	this.entityType_ = "query";
	this.projectId_ = "adwords-scripts-big-query";
	this.dataSetId_ = AdWordsApp.currentAccount().getName().replace(/[^a-zA-Z0-9 ]/g, "").replace(/\s/g, "_") + "_" + SCRIPT_NAME;
	this.fullTableName_ = this.projectId_ + "." + this.dataSetId_ + "." + this.entityType_;
	this.newTableDataInsertAllRequest = BigQuery.newTableDataInsertAllRequest();
	this.newTableDataInsertAllRequest.rows = [];
	this.cache = this.newTableDataInsertAllRequest.rows;

	var fieldSchemaObject = {};
	var fieldSchemaArray = [{
		"name": "task_id",
		"description": "primary key",
		"type": "STRING"
	}, {
		"name": "query",
		"description": "query name",
		"type": "STRING"
	}, {
		"name": "url",
		"description": "url",
		"type": "STRING"
	}, {
		"name": "done",
		"description": "has this task been retrieved from the API",
		"type": "STRING"
	}, {
		"name": "relatedSearches",
		"description": "related search results",
		"type": "STRING"
	}, {
		"name": "similarityValue",
		"description": "sim value of query",
		"type": "STRING"
	}];

	for (var i = fieldSchemaArray.length - 1; i >= 0; i--) {
		fieldSchemaObject[fieldSchemaArray[i].name] = fieldSchemaArray[i];
	}

	/**
	 * priviliged method to access the field schema of the UrlLookupStorageHandler as Array
	 * @return {Array} fieldSchemaArrray the field schema of the UrlLookupStorageHandler
	 */
	this.getFieldSchemaArray = function() {
		return fieldSchemaArray;
	};

	/**
	 * priviliged method to access the field schema of the UrlLookupStorageHandler as Object
	 * @return {Object} fieldSchemaArrray the field schema of the UrlLookupStorageHandler
	 */
	this.getFieldSchemaObject = function() {
		return fieldSchemaObject;
	};

	// initialize database
	this.database_init_();
}

/**
 * initializes the DB with generic query. If data table exists it will succeed. If not, the UrlLookupStorageHandler creates a new data set and tabel in the given project.
 * @return {void}
 */
UrlLookupStorageHandler.prototype.database_init_ = function() {
	var queryRequest = BigQuery.newQueryRequest();
	queryRequest.query = 'select * from `' + this.fullTableName_ + '` LIMIT 1;';
	queryRequest.useLegacySql = false;
	try {
		var query = BigQuery.Jobs.query(queryRequest, this.projectId_);
		Logger.log("BigQuery database '" + this.fullTableName_ + "' initialized.");
	} catch (e) {
		Logger.log("Error message: " + e);
		try {
			this.createDataSet_();
		} catch (e) {
			Logger.log("Error: " + e);
			Logger.log("Message: " + e.message);
			Logger.log("Stacktrace: " + e.stack);
		}
		try {
			this.createTable_(this.getFieldSchemaArray());
		} catch (e) {
			Logger.log("Error: " + e);
			Logger.log("Message: " + e.message);
			Logger.log("Stacktrace: " + e.stack);
			throw "Database could not be initialized. Exiting...";
		}
	}
};

/**
 * creates a new data set for the given entity type
 * @return {void}
 */
UrlLookupStorageHandler.prototype.createDataSet_ = function() {
	var dataSet = BigQuery.newDataset();
	dataSet.id = this.dataSetId_;
	dataSet.friendlyName = this.dataSetId_;
	dataSet.datasetReference = BigQuery.newDatasetReference();
	dataSet.datasetReference.projectId = this.projectId_;
	dataSet.datasetReference.datasetId = this.dataSetId_;
	try {
		dataSet = BigQuery.Datasets.insert(dataSet, this.projectId_);
	} catch (e) {
		throw new Error("Data set could not be created: " + e + ". Stack: " + e.stack);
	}

	Logger.log('Data set with ID = %s, Name = %s created.', dataSet.id, dataSet.friendlyName);
};

/**
 * creates a new table for the given entity type
 * @return {void} 
 */
UrlLookupStorageHandler.prototype.createTable_ = function() {
	var table = BigQuery.newTable();
	var schema = BigQuery.newTableSchema();
	schema.fields = this.convertSchemaIntoFields_();

	table.schema = schema;
	table.id = this.entityType_;
	table.friendlyName = this.entityType_;

	table.tableReference = BigQuery.newTableReference();
	table.tableReference.datasetId = this.dataSetId_;
	table.tableReference.projectId = this.projectId_;
	table.tableReference.tableId = this.entityType_;

	try {
		table = BigQuery.Tables.insert(table, this.projectId_, this.dataSetId_);
	} catch (e) {
		throw new Error("Data set could not be created: " + e + ". Stack: " + e.stack);
	}

	Logger.log('Data table with ID = %s, Name = %s created.', table.id, table.friendlyName);
};


/**
 * builds a new query from a given set of instructions
 * @param  {Array} fieldArray Array of fields that shall be accessed
 * @param  {Array} whereClauseArray Array of Objects (see API doc) of where clauses
 * @param  {Array} optionalClauses  Array of optional clauses
 * @return {String}
 */
UrlLookupStorageHandler.prototype.buildSelectQuery_ = function(fieldArray, whereClauseArray, optionalClauses) {
	if (typeof whereClauseArray == 'undefined' || !whereClauseArray) {
		whereClauseArray = [];
	}
	if (typeof fieldArray == 'undefined' || !fieldArray) {
		fieldArray = [];
	}
	if (typeof optionalClauses == 'undefined' || !optionalClauses) {
		optionalClauses = [];
	}

	var fullQuery = 'select ';
	var schemaObject = this.getFieldSchemaObject();

	if (fieldArray.length === 0) {
		fullQuery += ' * ';
	} else {
		for (var i = 0; i < fieldArray.length; i++) {
			if (!schemaObject[fieldArray[i]]) {
				Logger.log("The field %s is not defined in the table %s and will be ignored.", fieldArray[i], this.fullTableName_);
			}
			fullQuery += fieldArray[i];
			if (i != fieldArray.length - 1) {
				fullQuery += ',';
			}
		}
	}
	fullQuery += ' from `' + this.fullTableName_ + '` ';

	if (whereClauseArray.length !== 0) {
		fullQuery += 'where ';
		for (var k = 0; k < whereClauseArray.length; k++) {
			if (!schemaObject[whereClauseArray[k].inputField]) {
				Logger.log("The field %s is not defined in the table %s and will be ignored.", whereClauseArray[k], this.fullTableName_);
			}

			if (whereClauseArray[k].operator.toLowerCase() == "in") {
				fullQuery += '(' + whereClauseArray[k].inputField + ' ' + whereClauseArray[k].operator + ' (' + whereClauseArray[k].value + ')';
			} else {
				fullQuery += '(' + whereClauseArray[k].inputField + ' ' + whereClauseArray[k].operator + ' "' + whereClauseArray[k].value + '"';
			}

			if (k != whereClauseArray.length - 1) {
				fullQuery += ') AND ';
			} else {
				fullQuery += ');';
			}
		}
	}

	for (var j = 0; j < optionalClauses.length; j++) {
		fullQuery += " " + optionalClauses[j];
	}
	//if(DEBUG_MODE === 1) Logger.log("fullQuery: '" + fullQuery + "'");
	return fullQuery;
};


/**
 * queries the data table of the storage handler with a previously built query
 * @param  {String} queryString 
 * @return {Array} values of the response
 */
UrlLookupStorageHandler.prototype.queryDataTable_ = function(queryString) {
	var queryRequest = BigQuery.newQueryRequest();
	var fullTableName = this.projectId_ + ':' + this.dataSetId_ + '.' + this.entityType_;
	queryRequest.query = queryString;
	queryRequest.useLegacySql = false;
	var query = BigQuery.Jobs.query(queryRequest, this.projectId_);
	var values = [];

	while (!query.jobComplete) {
		Utilities.sleep(2000);
	}

	if (query.jobComplete) {
		if (typeof query.rows != "undefined") {
			for (var i = 0; i < query.rows.length; i++) {
				values[i] = [];
				var row = query.rows[i];
				for (var j = 0; j < row.f.length; j++) {
					values[i].push(row.f[j].v);
				}
			}
			return values;
		} else {
			if (DEBUG_MODE === 1) Logger.log("No data found for query " + queryString);
			return values;
		}
	}
};

/**
 * Converts the standard javascript schema array into a BigQuery.TabelFieldSchema
 * @return {BigQuery.TabelFieldSchema}
 */
UrlLookupStorageHandler.prototype.convertSchemaIntoFields_ = function() {
	var schema = [];
	var internalSchema = this.getFieldSchemaArray();

	for (var i = 0; i < internalSchema.length; i++) {
		var newFieldSchema = BigQuery.newTableFieldSchema();
		newFieldSchema.name = internalSchema[i].name;
		newFieldSchema.type = internalSchema[i].type;
		newFieldSchema.description = internalSchema[i].description;
		schema.push(newFieldSchema);
	}
	return schema;
};


/**
 * function that loads unfinsished Task IDs
 * @return {Array} data
 */
UrlLookupStorageHandler.prototype.loadUnFinishedTaskIds = function() {
	var query = this.buildSelectQuery_(["task_id"], [{
		inputField: "done",
		operator: "<>",
		value: "yes"
	}]);

	var temp_data = this.queryDataTable_(query);
	var data = [];

	for (var i = 0; i < temp_data.length; i++) {
		data.push(temp_data[i][0]);
	}
	Logger.log("Loaded " + data.length + " unfinished tasks from DB: " + JSON.stringify(data));
	return data;
};

UrlLookupStorageHandler.prototype.pushDataToCache = function(task_id, query) {

	//insertAllRequest.ignoreUnknownValues = true;
	//insertAllRequest.skipInvalidRows = true;
	var newRow = BigQuery.newTableDataInsertAllRequestRows();
	var cacheBusterNumber = Math.floor(Math.random() * 100000);
	newRow.insertId = task_id + "_" + cacheBusterNumber;
	newRow.json = {
		'task_id': task_id,
		'query': query,
		'url': "",
		'relatedSearches': "",
		'done': "no"
	};
	this.newTableDataInsertAllRequest.rows.push(newRow);
};

UrlLookupStorageHandler.prototype.flush = function() {

	Logger.log("######");
	Logger.log("Flushing StorageHandler cache...");
	Logger.log("Current cache: " + JSON.stringify(this.cache));
	Logger.log("Starting to write data to database...");

	var result;
	try {
		result = BigQuery.Tabledata.insertAll(this.newTableDataInsertAllRequest, this.projectId_, this.dataSetId_, this.entityType_);
	} catch (e) {
		Logger.log("Data could not be inserted into table: " + e.stack);
		Logger.log("Error message: " + e.message);
		this.cache = [];
		throw e;
	}

	if (typeof(result.insertErrors) != "undefined" && result.insertErrors !== null) {
		var allErrors = [];
		for (var k = 0; k < result.insertErrors.length; k++) {
			var insertError = result.insertErrors[k];
			allErrors.push(Utilities.formatString('Error inserting item: %s', insertError.index));

			for (var j = 0; j < insertError.errors.length; j++) {
				var error = insertError.errors[j];
				allErrors.push(Utilities.formatString('- ' + error));
			}
		}
		Logger.log(allErrors.join('\n'));
	} else {
		Logger.log(Utilities.formatString('%s data rows inserted successfully.', this.newTableDataInsertAllRequest.rows.length));
	}
	this.cache = [];
};

/**
 * updates a row in the specific data table
 * @param  {Object} id  {idField:"aaa", idValue:"bbb"}
 * @param  {Array} args Array of Objects [{fieldName: "aaa", fieldValue:"bbb"},{fieldName: "ccc", fieldValue:"ddd"}]
 * @return {String} query
 */
UrlLookupStorageHandler.prototype.setStatusDone = function(task_id, url, relatedSearches, similarityValue) {
	if (typeof task_id == "undefined") {
		throw "No task_id for update process set.";
	}
	var query = "UPDATE ";
	query += "`" + this.fullTableName_ + "`";
	query += "SET ";
	query += "done = 'yes',";
	query += "url = '" + url + "',";
	query += "relatedSearches = '" + relatedSearches + "',";
	query += "similarityValue = '" + similarityValue + "' ";
	query += "WHERE task_id = '" + task_id + "'";

	this.queryDataTable_(query);
};

UrlLookupStorageHandler.prototype.isInStreamingBuffer = function(task_id) {
	var isInBuffer = false;
	if (typeof(task_id) == "undefined") {
		Logger.log("No task_id for update process set.");
		return true;
	}

	var query = "UPDATE ";
	query += "`" + this.fullTableName_ + "`";
	query += "SET ";
	query += "task_id = '" + task_id + "'";
	query += "WHERE task_id = '" + task_id + "'";

	try {
		this.queryDataTable_(query);
	} catch (e) {
		isInBuffer = true;
		Logger.log(e);
		Logger.log(e.stack);
	}
	return isInBuffer;
};


/*
Static URL Extractor
 */

/*
URL_LOOKUP_CONFIG.site = "ullapopken.nl";
var SEARCH_STRINGS = [
  "dames jassen sale",
  "broeken heren sale"
];

var extractorObject = {
  config: {
    numberOfSERPsToExtract: 3
  }
};
*/

function StaticUrlExtractor(searchEngine) {

	this.extractorObject = {
		config: {
			numberOfSERPsToExtract: 3
		}
	};

	// REFERENCE: https://coderwall.com/p/cq63og/extract-data-from-xpath-via-google-apps-script
	this.urlPrefix = "";
	this.searchEngine = searchEngine;

	switch (searchEngine.toLowerCase()) {
		// specific DuckDuckGo implementation  
		case "duckduckgo.com":
			this.urlPrefix = 'https://www.duckduckgo.com/?q=site%3A' + URL_LOOKUP_CONFIG.site + '+';
			this.extractorObject.elements = [{
				targetSelectorPrefix: 'class="result__a" href="/l/?kh=-1&amp;uddg=https%3A%2F%2F',
				targetSelectorSuffix: '">',
				attributeName: "url"
			}, {
				targetSelectorPrefix: 'class="result__a" href="/l/?kh=-1&amp;uddg=https%3A%2F%2F',
				targetSelectorSuffix: '">',
				attributeName: "description"
			}];
			break;

			// specific Google implementation
		case "google.de":
			this.urlPrefix = 'https://www.google.de/search?q=site%3A' + URL_LOOKUP_CONFIG.site + '+';
			this.extractorObject.elements = [{
				targetSelectorPrefix: 'h3 class="r"><a href="/url?q=',
				targetSelectorSuffix: '&amp;sa=U&amp;',
				attributeName: "url"
			}, {
				targetSelectorPrefix: '<span class="st">',
				targetSelectorSuffix: '</span><br>',
				attributeName: "description"
			}];
			break;
	}
}

StaticUrlExtractor.prototype.getStaticUrl = function(query) {
	var searchUrl = this.urlPrefix + query.replace(/ /g, "+");
	Logger.log("searchUrl : " + searchUrl);
	var fetchedUrl;
	try {
		fetchedUrl = UrlFetchApp.fetch(searchUrl);
	} catch (e) {
		Logger.log("error: " + e.stack);
		Logger.log("error: " + e);
	}
	var returnObject = {
		url: "",
		similarityValue: 0
	};
	// Extract string string from full HTML content
	var urlContentAsString;
	try {
		urlContentAsString = fetchedUrl.getContentText(); //.toString();
	} catch (e) {
		Logger.log("error: " + e.stack);
		Logger.log("error: " + e);
	}
	//Logger.log(urlContentAsString);

	try {
		for (var i = 0; i < this.extractorObject.elements.length; i++) {
			var attribute = this.extractorObject.elements[i];
			var object;
			try {
				object = urlContentAsString.split(attribute.targetSelectorPrefix)[j + 1].split(attribute.targetSelectorSuffix)[0]
					.replace(/\<br\>/g, "")
					.replace(/<b>/g, "")
					.replace(/<\/b>/g, "")
					.replace(/\n/g, "")
					.replace(/\&middot\;/g, ".")
					.replace(/\&nbsp\;/g, "");
			} catch (e) {
				throw "Couldn't find " + (j + 1) + ". serp to extract: " + e;
			}
			returnObject[attribute.attributeName] = object;
		}
	} catch (e2) {
		Logger.log("An error occured during serp extraction: " + e2);
	}

	returnObject.similarityValue = calculateSimilarityValue(query, returnObject.url);

	return returnObject;
};

StaticUrlExtractor.prototype.calculateSimilarityValue = function(query, url) {
	if (!url || !query) {
		return 0;
	}
	var match;
	var regex = /^h?t?t?p?s?\:?\/?\/?www\.[\w|\d|\-|\_]*\.\w*\/(.*)$/gi;

	match = url.split(URL_LOOKUP_CONFIG.site + "/")[1];

	if (typeof(match) == "undefined" || !match) {
		return 0;
	}

	var validatedUrl = match.replace(/\//g, " ");
	validatedUrl = validatedUrl.replace(/^\s/, "").replace(/\s$/, "");
	validatedUrl = validatedUrl.split("-").join(" ");
	validatedUrl = validatedUrl.replace(URL_LOOKUP_CONFIG.brand_name, "").split(" ").sort().join(" ");

	query = query.split("-").join(" ");
	query = query.replace(URL_LOOKUP_CONFIG.brand_name + " ", "").split(" ").sort().join(" ");

	var wordDistance = this._calculateLetterChanges(query, validatedUrl);
	var simValue = (1 - wordDistance / validatedUrl.length).toFixed(2);

	return Math.abs(simValue);
};

/**
 * calculate letter changes between to words
 * @param  {string} a first word
 * @param  {string} b second word
 * @return {number}  
 */
StaticUrlExtractor.prototype._calculateLetterChanges = function(a, b) {
	var tmp;
	if (a.length === 0) {
		return b.length;
	}
	if (b.length === 0) {
		return a.length;
	}
	if (a.length > b.length) {
		tmp = a;
		a = b;
		b = tmp;
	}

	var i, j, res, alen = a.length,
		blen = b.length,
		row = Array(alen);
	for (i = 0; i <= alen; i++) {
		row[i] = i;
	}

	for (i = 1; i <= blen; i++) {
		res = i;
		for (j = 1; j <= alen; j++) {
			tmp = row[j - 1];
			row[j - 1] = res;
			res = b[i - 1] === a[j - 1] ? tmp : Math.min(tmp + 1, Math.min(res + 1, row[j] + 1));
		}
	}
	return res;
};



// https://tc39.github.io/ecma262/#sec-array.prototype.findIndex
if (!Array.prototype.findIndex) {
	Object.defineProperty(Array.prototype, 'findIndex', {
		value: function(predicate) {
			// 1. Let O be ? ToObject(this value).
			if (this == null) {
				throw new TypeError('"this" is null or not defined');
			}

			var o = Object(this);

			// 2. Let len be ? ToLength(? Get(O, "length")).
			var len = o.length >>> 0;

			// 3. If IsCallable(predicate) is false, throw a TypeError exception.
			if (typeof predicate !== 'function') {
				throw new TypeError('predicate must be a function');
			}

			// 4. If thisArg was supplied, let T be thisArg; else let T be undefined.
			var thisArg = arguments[1];

			// 5. Let k be 0.
			var k = 0;

			// 6. Repeat, while k < len
			while (k < len) {
				// a. Let Pk be ! ToString(k).
				// b. Let kValue be ? Get(O, Pk).
				// c. Let testResult be ToBoolean(? Call(predicate, T, « kValue, k, O »)).
				// d. If testResult is true, return k.
				var kValue = o[k];
				if (predicate.call(thisArg, kValue, k, o)) {
					return k;
				}
				// e. Increase k by 1.
				k++;
			}

			// 7. Return -1.
			return -1;
		},
		configurable: true,
		writable: true
	});
}
