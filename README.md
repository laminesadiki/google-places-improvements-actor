# Crawler Google Places
Get data from Google Places that the official [Google Maps Places API](https://developers.google.com/places/web-service/search) does not provide.


## Usage

If you want to run the actor on Apify platform, you need to have at least a few proxy IPs to avoid blocking from Google. You can use proxy IPs pool on Apify proxy trial or you can subscribe to one of [Apify subscription plan](https://apify.com/pricing).
It is recommended to run the actor with at least 8GB memory. On Apify platform with 8GB memory you can get 100 google place details for 4 compute units


## INPUT

Example input:
```json
{
  "spreadsheetId": "1LJj3ndwvgoXgqt0CbweFQFmckbfUDcno5ZuBeEcMq_o"
}
```
On this input actor searches places based on data from the spreadsheet with ID: 1LJj3ndwvgoXgqt0CbweFQFmckbfUDcno5ZuBeEcMq_o

- `spreadsheetId` - Spreadsheet ID, the spreadsheet contains one sheet with 3 columns: `City`, `Country`, and `Category`
- `proxyConfig` - Apify proxy configuration
- `maxCrawledPlaces` - Limit places you want to get from crawler
- `debug` - Debug messages will be included in log.


### Country localization
You can force the scraper to access the places only from specific country location. We recommend this to ensure the correct language in results. This works reliably only for US (most of our proxies are from US). Currently, this option is not available in the Editor input , you have switch to JSON input. After you switch, your configuration will remain the same so just update the `proxyconfig` field with `apifyProxyCountry` property to specify the country, example:

```
"proxyConfig": {
    "useApifyProxy": true,
    "apifyProxyCountry": "US"
  }
```

## OUTPUT
Once the actor finishes, it outputs results to actor default dataset.

Example results item:

```text

```
