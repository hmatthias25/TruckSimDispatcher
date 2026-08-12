using TruckSimDispatcher.Models;

namespace TruckSimDispatcher.Services;

/// <summary>
/// Freight-market reference table used for positioning and reset planning.
/// Covers the official SCS map DLC plus the wider continental coverage that the
/// Coast to Coast and More American Cities mods add.
///
/// Tier 1 = strong outbound freight, easy reload.
/// Tier 2 = moderate; usually reloadable but thinner.
/// Tier 3 = thin market / backhaul risk. Dispatch avoids ending a tour here unless paid to.
/// Reset flag = has the truck parking, fuel and services to sit a restart.
/// </summary>
public static class Markets
{
    // City|ST|Tier|Reset(1/0)|Source|Strong divisions
    private const string Table = """
    Los Angeles|CA|1|0|Official|Dry Van,Reefer,Port,Intermodal
    Long Beach|CA|1|0|C2C|Port,Intermodal,Dry Van
    Oakland|CA|1|0|Official|Port,Reefer,Intermodal
    San Francisco|CA|1|0|Official|Dry Van,Reefer
    San Jose|CA|1|0|Official|Dry Van,Reefer
    Sacramento|CA|1|1|Official|Dry Van,Reefer,Ag
    Stockton|CA|1|1|Official|Reefer,Ag,Dry Van
    Fresno|CA|1|1|Official|Reefer,Ag
    Bakersfield|CA|1|1|Official|Reefer,Ag,Tanker
    San Diego|CA|1|0|Official|Dry Van,Reefer
    Barstow|CA|2|1|Official|Dry Van,Intermodal
    Redding|CA|2|1|Official|Log,Flatbed
    Eureka|CA|3|0|Official|Log,Flatbed
    Ukiah|CA|3|0|Official|Log,Ag
    Santa Cruz|CA|3|0|Official|Reefer,Ag
    San Rafael|CA|3|0|Official|Dry Van
    Carlsbad|CA|2|0|Official|Dry Van,Reefer
    El Centro|CA|2|1|Official|Reefer,Ag
    Huron|CA|3|0|Official|Ag,Reefer
    Oxnard|CA|2|0|Official|Reefer,Ag
    Paso Robles|CA|3|0|Official|Ag,Reefer
    San Luis Obispo|CA|3|0|Official|Dry Van
    Santa Maria|CA|3|0|Official|Reefer,Ag
    Truckee|CA|3|1|Official|Dry Van
    Las Vegas|NV|1|1|Official|Dry Van,Reefer,Flatbed
    Reno|NV|1|1|Official|Dry Van,Intermodal,Flatbed
    Carson City|NV|2|0|Official|Dry Van
    Elko|NV|2|1|Official|Heavy Haul,Flatbed,Tanker
    Ely|NV|3|1|Official|Heavy Haul,Flatbed
    Winnemucca|NV|3|1|Official|Flatbed,Tanker
    Tonopah|NV|3|1|Official|Heavy Haul,Flatbed
    Jackpot|NV|3|1|Official|Dry Van
    Primm|NV|3|1|Official|Dry Van
    Pioche|NV|3|0|Official|Heavy Haul
    Fallon|NV|3|1|C2C|Ag,Dry Van
    Phoenix|AZ|1|1|Official|Dry Van,Reefer,Flatbed
    Tucson|AZ|1|1|Official|Dry Van,Flatbed,Heavy Haul
    Flagstaff|AZ|2|1|Official|Dry Van,Log
    Yuma|AZ|2|1|Official|Reefer,Ag
    Kingman|AZ|2|1|Official|Dry Van,Flatbed
    Nogales|AZ|2|1|Official|Reefer,Ag
    Page|AZ|3|0|Official|Flatbed,Tanker
    Show Low|AZ|3|0|Official|Log,Flatbed
    Sierra Vista|AZ|3|0|Official|Dry Van
    Camp Verde|AZ|3|1|Official|Dry Van
    Clifton|AZ|3|0|Official|Heavy Haul,Flatbed
    Ehrenberg|AZ|3|1|Official|Dry Van,Reefer
    Globe|AZ|3|0|Official|Heavy Haul,Flatbed
    Holbrook|AZ|3|1|Official|Dry Van,Flatbed
    Winslow|AZ|3|1|Official|Dry Van
    Springerville|AZ|3|0|Official|Log,Flatbed
    San Simon|AZ|3|1|Official|Dry Van
    Albuquerque|NM|1|1|Official|Dry Van,Reefer,Flatbed
    Santa Fe|NM|2|0|Official|Dry Van
    Las Cruces|NM|2|1|Official|Reefer,Ag,Dry Van
    Roswell|NM|2|1|Official|Ag,Tanker,Livestock
    Farmington|NM|2|1|Official|Tanker,Heavy Haul
    Gallup|NM|2|1|Official|Dry Van,Flatbed
    Hobbs|NM|2|1|Official|Tanker,Heavy Haul,Flatbed
    Carlsbad|NM|2|1|Official|Tanker,Heavy Haul
    Clovis|NM|3|1|Official|Ag,Livestock,Reefer
    Alamogordo|NM|3|0|Official|Dry Van
    Artesia|NM|3|1|Official|Tanker
    Raton|NM|3|1|Official|Dry Van
    Socorro|NM|3|1|Official|Flatbed
    Tucumcari|NM|3|1|Official|Dry Van
    Grants|NM|3|1|Official|Flatbed
    Deming|NM|3|1|Official|Dry Van,Reefer
    Lordsburg|NM|3|1|Official|Dry Van
    Portland|OR|1|1|Official|Dry Van,Reefer,Intermodal,Log
    Salem|OR|2|1|Official|Reefer,Ag,Log
    Eugene|OR|2|1|Official|Log,Flatbed,Reefer
    Medford|OR|2|1|Official|Reefer,Log
    Bend|OR|2|1|Official|Log,Dry Van
    Klamath Falls|OR|3|1|Official|Log,Flatbed
    Pendleton|OR|3|1|Official|Ag,Dry Van
    Astoria|OR|3|0|Official|Reefer,Log
    Coos Bay|OR|3|0|Official|Log,Flatbed
    Newport|OR|3|0|Official|Reefer
    The Dalles|OR|3|1|Official|Ag,Flatbed
    Ontario|OR|3|1|Official|Ag,Reefer
    Burns|OR|3|1|Official|Livestock,Flatbed
    Lakeview|OR|3|0|Official|Log
    Seattle|WA|1|0|Official|Port,Intermodal,Dry Van,Reefer
    Tacoma|WA|1|1|Official|Port,Intermodal,Flatbed
    Spokane|WA|1|1|Official|Dry Van,Reefer,Ag
    Vancouver|WA|2|1|Official|Dry Van,Log
    Yakima|WA|2|1|Official|Reefer,Ag
    Bellingham|WA|2|0|Official|Reefer,Dry Van
    Olympia|WA|2|1|Official|Log,Dry Van
    Everett|WA|2|0|Official|Flatbed,Dry Van
    Longview|WA|2|1|Official|Log,Flatbed,Port
    Wenatchee|WA|3|0|Official|Reefer,Ag
    Pasco|WA|2|1|Official|Ag,Reefer,Intermodal
    Aberdeen|WA|3|0|Official|Log
    Colville|WA|3|0|Official|Log,Flatbed
    Omak|WA|3|0|Official|Ag,Log
    Port Angeles|WA|3|0|Official|Log
    Grand Coulee|WA|3|0|Official|Heavy Haul
    Salt Lake City|UT|1|1|Official|Dry Van,Reefer,Flatbed,Intermodal
    Ogden|UT|1|1|Official|Dry Van,Flatbed
    Provo|UT|2|1|Official|Dry Van,Flatbed
    St. George|UT|2|1|Official|Dry Van,Flatbed
    Moab|UT|3|0|Official|Heavy Haul,Flatbed
    Price|UT|3|1|Official|Flatbed,Tanker
    Logan|UT|3|0|Official|Ag,Reefer
    Cedar City|UT|3|1|Official|Flatbed,Livestock
    Vernal|UT|3|1|Official|Tanker,Heavy Haul
    Green River|UT|3|1|Official|Dry Van
    Blanding|UT|3|0|Official|Flatbed
    Salina|UT|3|1|Official|Dry Van
    Boise|ID|1|1|Official|Dry Van,Reefer,Ag
    Nampa|ID|2|1|Official|Ag,Reefer
    Idaho Falls|ID|2|1|Official|Ag,Reefer,Flatbed
    Twin Falls|ID|2|1|Official|Ag,Reefer,Livestock
    Pocatello|ID|2|1|Official|Ag,Flatbed,Intermodal
    Lewiston|ID|3|1|Official|Log,Ag
    Coeur d'Alene|ID|2|1|Official|Log,Dry Van
    Sandpoint|ID|3|0|Official|Log
    Salmon|ID|3|0|Official|Livestock,Log
    Ketchum|ID|3|0|Official|Dry Van
    Grangeville|ID|3|0|Official|Log,Ag
    Riggins|ID|3|0|Official|Log
    Denver|CO|1|1|Official|Dry Van,Reefer,Flatbed,Intermodal
    Colorado Springs|CO|1|1|Official|Dry Van,Flatbed
    Pueblo|CO|2|1|Official|Flatbed,Ag,Heavy Haul
    Grand Junction|CO|2|1|Official|Flatbed,Tanker
    Fort Collins|CO|2|1|Official|Dry Van,Reefer
    Durango|CO|3|0|Official|Flatbed,Log
    Alamosa|CO|3|1|Official|Ag,Livestock
    Lamar|CO|3|1|Official|Ag,Livestock
    Sterling|CO|3|1|Official|Ag,Livestock
    Limon|CO|3|1|Official|Dry Van
    Montrose|CO|3|0|Official|Flatbed,Ag
    Craig|CO|3|1|Official|Tanker,Flatbed
    Gunnison|CO|3|0|Official|Flatbed
    Burlington|CO|3|1|Official|Ag
    Cheyenne|WY|2|1|Official|Dry Van,Flatbed,Intermodal
    Casper|WY|2|1|Official|Tanker,Heavy Haul,Flatbed
    Laramie|WY|3|1|Official|Dry Van,Flatbed
    Rock Springs|WY|3|1|Official|Tanker,Heavy Haul,Flatbed
    Gillette|WY|2|1|Official|Heavy Haul,Tanker,Flatbed
    Sheridan|WY|3|1|Official|Livestock,Flatbed
    Rawlins|WY|3|1|Official|Tanker,Dry Van
    Riverton|WY|3|1|Official|Tanker,Flatbed
    Cody|WY|3|0|Official|Livestock,Flatbed
    Jackson|WY|3|0|Official|Dry Van,Reefer
    Evanston|WY|3|1|Official|Tanker,Dry Van
    Torrington|WY|3|1|Official|Ag,Livestock
    Buffalo|WY|3|1|Official|Flatbed,Livestock
    Newcastle|WY|3|1|Official|Tanker
    Sundance|WY|3|1|Official|Log,Flatbed
    Billings|MT|2|1|Official|Ag,Flatbed,Reefer,Tanker
    Missoula|MT|2|1|Official|Log,Dry Van,Flatbed
    Great Falls|MT|2|1|Official|Ag,Flatbed,Livestock
    Butte|MT|3|1|Official|Heavy Haul,Flatbed
    Bozeman|MT|3|1|Official|Dry Van,Reefer
    Helena|MT|3|1|Official|Flatbed,Dry Van
    Kalispell|MT|3|1|Official|Log,Flatbed
    Havre|MT|3|1|Official|Ag,Livestock
    Lewistown|MT|3|0|Official|Ag,Livestock
    Miles City|MT|3|1|Official|Livestock,Ag
    Glendive|MT|3|1|Official|Tanker,Ag
    Sidney|MT|3|1|Official|Tanker,Ag
    Cut Bank|MT|3|1|Official|Ag,Tanker
    Glasgow|MT|3|1|Official|Ag,Livestock
    Hardin|MT|3|0|Official|Ag,Livestock
    Whitefish|MT|3|0|Official|Log
    Dallas|TX|1|1|Official|Dry Van,Reefer,Flatbed,Intermodal
    Fort Worth|TX|1|1|Official|Dry Van,Flatbed,Intermodal
    Houston|TX|1|1|Official|Tanker,Port,Flatbed,Heavy Haul,Dry Van
    San Antonio|TX|1|1|Official|Dry Van,Reefer,Flatbed
    Austin|TX|1|1|Official|Dry Van,Reefer
    El Paso|TX|1|1|Official|Dry Van,Reefer,Intermodal
    Amarillo|TX|2|1|Official|Ag,Livestock,Reefer,Dry Van
    Lubbock|TX|2|1|Official|Ag,Livestock,Flatbed
    Laredo|TX|1|1|Official|Dry Van,Reefer,Intermodal
    Corpus Christi|TX|2|1|Official|Tanker,Port,Flatbed
    Odessa|TX|2|1|Official|Tanker,Heavy Haul,Flatbed
    Midland|TX|2|1|Official|Tanker,Heavy Haul,Flatbed
    Waco|TX|2|1|Official|Dry Van,Flatbed
    Abilene|TX|2|1|Official|Ag,Flatbed,Dry Van
    Beaumont|TX|2|1|Official|Tanker,Flatbed,Port
    Brownsville|TX|2|1|Official|Reefer,Port,Dry Van
    Galveston|TX|3|0|Official|Port,Tanker
    Del Rio|TX|3|1|Official|Dry Van,Ag
    Victoria|TX|3|1|Official|Tanker,Flatbed
    Huntsville|TX|3|1|Official|Log,Dry Van
    Lufkin|TX|3|1|Official|Log,Flatbed
    San Angelo|TX|3|1|Official|Ag,Livestock,Tanker
    Sherman|TX|3|1|Official|Dry Van,Flatbed
    Texarkana|TX|2|1|Official|Log,Dry Van,Flatbed
    Wichita Falls|TX|3|1|Official|Ag,Flatbed
    Pecos|TX|3|1|Official|Tanker,Heavy Haul
    Port Arthur|TX|3|1|Official|Tanker,Flatbed
    Rockport|TX|3|0|Official|Port,Reefer
    Oklahoma City|OK|1|1|Official|Dry Van,Reefer,Flatbed,Intermodal
    Tulsa|OK|1|1|Official|Dry Van,Flatbed,Heavy Haul,Tanker
    Lawton|OK|3|1|Official|Ag,Flatbed
    Enid|OK|3|1|Official|Ag,Tanker
    Woodward|OK|3|1|Official|Ag,Livestock
    Guymon|OK|3|1|Official|Livestock,Reefer
    McAlester|OK|3|1|Official|Flatbed,Dry Van
    Ardmore|OK|3|1|Official|Dry Van,Tanker
    Clinton|OK|3|1|Official|Dry Van
    Perry|OK|3|1|Official|Ag,Dry Van
    Sallisaw|OK|3|1|Official|Flatbed,Dry Van
    Wichita|KS|1|1|Official|Dry Van,Flatbed,Ag,Reefer
    Kansas City|KS|1|1|Official|Dry Van,Reefer,Intermodal
    Topeka|KS|2|1|Official|Dry Van,Ag,Flatbed
    Salina|KS|2|1|Official|Ag,Dry Van
    Dodge City|KS|2|1|Official|Livestock,Reefer,Ag
    Garden City|KS|2|1|Official|Livestock,Reefer,Ag
    Liberal|KS|3|1|Official|Livestock,Reefer
    Hays|KS|3|1|Official|Ag,Dry Van
    Emporia|KS|3|1|Official|Dry Van,Ag
    Hutchinson|KS|3|1|Official|Ag,Flatbed
    Colby|KS|3|1|Official|Ag,Livestock
    Great Bend|KS|3|1|Official|Ag,Tanker
    Pittsburg|KS|3|1|Official|Flatbed,Dry Van
    Ulysses|KS|3|1|Official|Ag,Livestock
    Omaha|NE|1|1|Official|Dry Van,Reefer,Intermodal,Ag
    Lincoln|NE|2|1|Official|Ag,Dry Van,Flatbed
    Grand Island|NE|2|1|Official|Ag,Livestock,Reefer
    North Platte|NE|2|1|Official|Ag,Intermodal,Livestock
    Scottsbluff|NE|3|1|Official|Ag,Livestock
    Norfolk|NE|3|1|Official|Ag,Livestock
    Kearney|NE|3|1|Official|Ag,Dry Van
    McCook|NE|3|1|Official|Ag
    Sidney|NE|3|1|Official|Ag,Dry Van
    Alliance|NE|3|1|Official|Ag,Intermodal
    Columbus|NE|3|1|Official|Ag,Flatbed
    Des Moines|IA|1|1|Official|Dry Van,Reefer,Ag,Intermodal
    Cedar Rapids|IA|2|1|Official|Ag,Dry Van,Tanker
    Davenport|IA|2|1|Official|Ag,Flatbed,Heavy Haul
    Sioux City|IA|2|1|Official|Livestock,Reefer,Ag
    Council Bluffs|IA|2|1|Official|Dry Van,Intermodal,Ag
    Waterloo|IA|2|1|Official|Ag,Heavy Haul,Flatbed
    Dubuque|IA|3|1|Official|Ag,Flatbed
    Iowa City|IA|3|1|Official|Dry Van,Ag
    Mason City|IA|3|1|Official|Ag,Flatbed
    Fort Dodge|IA|3|1|Official|Ag,Tanker
    Ottumwa|IA|3|1|Official|Ag,Reefer
    Ames|IA|3|1|Official|Ag,Dry Van
    Kansas City|MO|1|1|Official|Dry Van,Reefer,Intermodal,Flatbed
    St. Louis|MO|1|1|Official|Dry Van,Reefer,Intermodal,Tanker
    Springfield|MO|2|1|Official|Dry Van,Reefer,Flatbed
    Columbia|MO|2|1|Official|Dry Van,Ag
    Joplin|MO|2|1|Official|Dry Van,Flatbed,Reefer
    St. Joseph|MO|2|1|Official|Ag,Reefer,Livestock
    Cape Girardeau|MO|3|1|Official|Flatbed,Ag
    Jefferson City|MO|3|1|Official|Dry Van,Flatbed
    Sikeston|MO|3|1|Official|Ag,Dry Van
    Rolla|MO|3|1|Official|Dry Van
    Hannibal|MO|3|1|Official|Ag,Flatbed
    Poplar Bluff|MO|3|1|Official|Log,Ag
    Kirksville|MO|3|0|Official|Ag
    Chicago|IL|1|1|Official|Dry Van,Reefer,Intermodal,Flatbed
    Joliet|IL|1|1|Official|Intermodal,Dry Van,Tanker
    Rockford|IL|2|1|Official|Dry Van,Flatbed,Heavy Haul
    Peoria|IL|2|1|Official|Heavy Haul,Flatbed,Ag
    Springfield|IL|2|1|Official|Ag,Dry Van
    Champaign|IL|2|1|Official|Ag,Dry Van
    Decatur|IL|2|1|Official|Ag,Tanker
    Bloomington|IL|3|1|Official|Ag,Dry Van
    Quincy|IL|3|1|Official|Ag,Flatbed
    Effingham|IL|2|1|Official|Dry Van,Reefer
    Mount Vernon|IL|3|1|Official|Dry Van,Flatbed
    Galesburg|IL|3|1|Official|Ag,Intermodal
    Danville|IL|3|1|Official|Ag,Dry Van
    Carbondale|IL|3|1|Official|Ag,Flatbed
    East St. Louis|IL|2|1|Official|Intermodal,Tanker,Dry Van
    Fargo|ND|2|1|C2C|Ag,Reefer,Dry Van
    Bismarck|ND|3|1|C2C|Ag,Tanker,Flatbed
    Minot|ND|3|1|C2C|Tanker,Ag
    Grand Forks|ND|3|1|C2C|Ag,Reefer
    Williston|ND|3|1|C2C|Tanker,Heavy Haul
    Dickinson|ND|3|1|C2C|Tanker,Ag
    Sioux Falls|SD|2|1|C2C|Ag,Reefer,Livestock,Dry Van
    Rapid City|SD|3|1|C2C|Flatbed,Livestock,Ag
    Pierre|SD|3|1|C2C|Ag,Livestock
    Aberdeen|SD|3|1|C2C|Ag,Livestock
    Watertown|SD|3|1|C2C|Ag,Reefer
    Minneapolis|MN|1|1|C2C|Dry Van,Reefer,Intermodal,Flatbed
    St. Paul|MN|1|1|C2C|Dry Van,Reefer,Tanker
    Duluth|MN|2|1|C2C|Log,Flatbed,Port,Heavy Haul
    Rochester|MN|3|1|C2C|Ag,Reefer
    St. Cloud|MN|3|1|C2C|Ag,Dry Van
    Mankato|MN|3|1|C2C|Ag,Reefer
    Moorhead|MN|3|1|C2C|Ag,Reefer
    Milwaukee|WI|1|1|C2C|Dry Van,Reefer,Flatbed,Intermodal
    Madison|WI|2|1|C2C|Reefer,Ag,Dry Van
    Green Bay|WI|2|1|C2C|Reefer,Flatbed,Port
    Eau Claire|WI|3|1|C2C|Ag,Dry Van
    La Crosse|WI|3|1|C2C|Ag,Reefer
    Wausau|WI|3|1|C2C|Log,Flatbed
    Janesville|WI|3|1|C2C|Dry Van,Auto
    Detroit|MI|1|1|C2C|Auto,Dry Van,Flatbed,Intermodal
    Grand Rapids|MI|2|1|C2C|Dry Van,Reefer,Flatbed
    Lansing|MI|2|1|C2C|Auto,Dry Van
    Flint|MI|2|1|C2C|Auto,Flatbed
    Saginaw|MI|3|1|C2C|Auto,Flatbed
    Kalamazoo|MI|3|1|C2C|Dry Van,Auto
    Traverse City|MI|3|0|C2C|Reefer,Log
    Marquette|MI|3|0|C2C|Log,Heavy Haul
    Port Huron|MI|3|1|C2C|Dry Van,Auto
    Indianapolis|IN|1|1|C2C|Dry Van,Reefer,Intermodal,Flatbed
    Fort Wayne|IN|2|1|C2C|Dry Van,Flatbed,Auto
    Gary|IN|2|1|C2C|Flatbed,Heavy Haul,Intermodal
    South Bend|IN|2|1|C2C|Dry Van,Auto
    Evansville|IN|2|1|C2C|Flatbed,Tanker,Dry Van
    Terre Haute|IN|3|1|C2C|Dry Van,Ag
    Elkhart|IN|2|1|C2C|Flatbed,Dry Van,Oversize
    Lafayette|IN|3|1|C2C|Ag,Auto
    Columbus|OH|1|1|C2C|Dry Van,Reefer,Intermodal
    Cleveland|OH|1|1|C2C|Flatbed,Heavy Haul,Dry Van,Port
    Cincinnati|OH|1|1|C2C|Dry Van,Reefer,Intermodal
    Toledo|OH|2|1|C2C|Auto,Flatbed,Port
    Dayton|OH|2|1|C2C|Dry Van,Auto
    Akron|OH|2|1|C2C|Flatbed,Dry Van,Tanker
    Youngstown|OH|3|1|C2C|Flatbed,Heavy Haul
    Canton|OH|3|1|C2C|Flatbed,Heavy Haul
    Louisville|KY|1|1|C2C|Dry Van,Reefer,Intermodal,Auto
    Lexington|KY|2|1|C2C|Dry Van,Auto,Livestock
    Bowling Green|KY|2|1|C2C|Auto,Dry Van
    Paducah|KY|3|1|C2C|Tanker,Flatbed
    Covington|KY|3|1|C2C|Dry Van,Intermodal
    Nashville|TN|1|1|C2C|Dry Van,Reefer,Auto,Intermodal
    Memphis|TN|1|1|C2C|Dry Van,Reefer,Intermodal,Port
    Knoxville|TN|2|1|C2C|Dry Van,Flatbed
    Chattanooga|TN|2|1|C2C|Dry Van,Auto,Flatbed
    Jackson|TN|3|1|C2C|Dry Van,Ag
    Little Rock|AR|2|1|C2C|Dry Van,Reefer,Flatbed
    Fort Smith|AR|3|1|C2C|Dry Van,Flatbed
    Springdale|AR|2|1|C2C|Reefer,Dry Van,Livestock
    Jonesboro|AR|3|1|C2C|Ag,Reefer
    West Memphis|AR|2|1|C2C|Dry Van,Intermodal
    New Orleans|LA|2|1|C2C|Port,Tanker,Flatbed
    Baton Rouge|LA|2|1|C2C|Tanker,Flatbed,Heavy Haul
    Shreveport|LA|2|1|C2C|Dry Van,Flatbed,Tanker
    Lafayette|LA|3|1|C2C|Tanker,Heavy Haul
    Lake Charles|LA|3|1|C2C|Tanker,Heavy Haul
    Monroe|LA|3|1|C2C|Ag,Log
    Jackson|MS|2|1|C2C|Dry Van,Flatbed
    Gulfport|MS|3|1|C2C|Port,Flatbed
    Hattiesburg|MS|3|1|C2C|Log,Dry Van
    Tupelo|MS|3|1|C2C|Dry Van,Flatbed
    Meridian|MS|3|1|C2C|Log,Dry Van
    Birmingham|AL|2|1|C2C|Flatbed,Heavy Haul,Dry Van
    Montgomery|AL|2|1|C2C|Dry Van,Auto,Flatbed
    Mobile|AL|2|1|C2C|Port,Flatbed,Tanker
    Huntsville|AL|2|1|C2C|Dry Van,Oversize,Flatbed
    Tuscaloosa|AL|3|1|C2C|Auto,Flatbed
    Dothan|AL|3|1|C2C|Ag,Dry Van
    Atlanta|GA|1|1|C2C|Dry Van,Reefer,Intermodal,Flatbed
    Savannah|GA|1|1|C2C|Port,Intermodal,Dry Van
    Macon|GA|2|1|C2C|Dry Van,Flatbed
    Columbus|GA|3|1|C2C|Dry Van,Flatbed
    Augusta|GA|3|1|C2C|Dry Van,Log
    Albany|GA|3|1|C2C|Ag,Reefer
    Jacksonville|FL|1|1|C2C|Port,Dry Van,Reefer,Auto
    Miami|FL|1|0|C2C|Port,Reefer,Dry Van
    Orlando|FL|1|1|C2C|Dry Van,Reefer
    Tampa|FL|1|1|C2C|Port,Tanker,Reefer,Dry Van
    Lakeland|FL|2|1|C2C|Reefer,Ag,Dry Van
    Ocala|FL|3|1|C2C|Ag,Livestock,Dry Van
    Tallahassee|FL|3|1|C2C|Dry Van,Log
    Fort Myers|FL|3|0|C2C|Reefer,Dry Van
    West Palm Beach|FL|3|0|C2C|Reefer,Dry Van
    Charleston|SC|2|1|C2C|Port,Intermodal,Dry Van
    Columbia|SC|2|1|C2C|Dry Van,Flatbed
    Greenville|SC|2|1|C2C|Dry Van,Auto,Flatbed
    Florence|SC|3|1|C2C|Dry Van,Reefer
    Charlotte|NC|1|1|C2C|Dry Van,Reefer,Intermodal,Flatbed
    Raleigh|NC|2|1|C2C|Dry Van,Reefer
    Greensboro|NC|2|1|C2C|Dry Van,Flatbed,Auto
    Wilmington|NC|3|1|C2C|Port,Flatbed
    Asheville|NC|3|1|C2C|Dry Van,Flatbed
    Fayetteville|NC|3|1|C2C|Dry Van,Heavy Haul
    Richmond|VA|2|1|C2C|Dry Van,Intermodal,Reefer
    Norfolk|VA|2|1|C2C|Port,Intermodal,Dry Van
    Roanoke|VA|3|1|C2C|Dry Van,Flatbed
    Winchester|VA|2|1|C2C|Dry Van,Reefer
    Bristol|VA|3|1|C2C|Dry Van,Flatbed
    Charleston|WV|3|1|C2C|Tanker,Flatbed,Heavy Haul
    Huntington|WV|3|1|C2C|Flatbed,Tanker
    Morgantown|WV|3|1|C2C|Flatbed,Heavy Haul
    Beckley|WV|3|1|C2C|Flatbed,Tanker
    Baltimore|MD|1|1|C2C|Port,Intermodal,Dry Van,Auto
    Hagerstown|MD|2|1|C2C|Dry Van,Reefer
    Frederick|MD|3|1|C2C|Dry Van
    Wilmington|DE|2|1|C2C|Port,Dry Van,Auto
    Dover|DE|3|1|C2C|Dry Van,Ag
    Philadelphia|PA|1|1|C2C|Port,Dry Van,Reefer,Intermodal
    Pittsburgh|PA|1|1|C2C|Flatbed,Heavy Haul,Dry Van
    Harrisburg|PA|1|1|C2C|Dry Van,Intermodal,Reefer
    Allentown|PA|1|1|C2C|Dry Van,Reefer,Intermodal
    Carlisle|PA|1|1|C2C|Dry Van,Intermodal
    Scranton|PA|2|1|C2C|Dry Van,Flatbed
    Erie|PA|3|1|C2C|Flatbed,Dry Van
    Newark|NJ|1|0|C2C|Port,Intermodal,Dry Van
    Trenton|NJ|2|1|C2C|Dry Van,Tanker
    Camden|NJ|2|1|C2C|Port,Dry Van
    Atlantic City|NJ|3|0|C2C|Dry Van,Reefer
    New York|NY|1|0|C2C|Dry Van,Reefer,Port
    Buffalo|NY|2|1|C2C|Dry Van,Flatbed,Intermodal
    Syracuse|NY|2|1|C2C|Dry Van,Flatbed
    Albany|NY|2|1|C2C|Dry Van,Reefer
    Rochester|NY|2|1|C2C|Dry Van,Flatbed
    Binghamton|NY|3|1|C2C|Dry Van,Flatbed
    Utica|NY|3|1|C2C|Dry Van,Ag
    Hartford|CT|2|1|C2C|Dry Van,Reefer
    New Haven|CT|2|0|C2C|Port,Dry Van,Tanker
    Bridgeport|CT|3|0|C2C|Dry Van
    Providence|RI|2|0|C2C|Dry Van,Port
    Boston|MA|1|0|C2C|Dry Van,Reefer,Port
    Worcester|MA|2|1|C2C|Dry Van,Reefer
    Springfield|MA|2|1|C2C|Dry Van,Reefer
    Burlington|VT|3|1|C2C|Reefer,Log
    Rutland|VT|3|0|C2C|Log,Flatbed
    Manchester|NH|3|1|C2C|Dry Van,Reefer
    Concord|NH|3|1|C2C|Dry Van,Log
    Portland|ME|3|1|C2C|Port,Reefer,Log
    Bangor|ME|3|1|C2C|Log,Reefer
    Augusta|ME|3|0|C2C|Log,Dry Van
    """;

    private static readonly List<MarketCity> _builtIn = Parse();

    public static IReadOnlyList<MarketCity> BuiltIn => _builtIn;

    private static List<MarketCity> Parse()
    {
        var list = new List<MarketCity>();
        foreach (var raw in Table.Split('\n'))
        {
            var line = raw.Trim();
            if (line.Length == 0) continue;
            var p = line.Split('|');
            if (p.Length < 5) continue;
            list.Add(new MarketCity
            {
                City = p[0].Trim(),
                State = p[1].Trim().ToUpperInvariant(),
                Tier = int.TryParse(p[2], out var t) ? t : 2,
                ResetFriendly = p[3].Trim() == "1",
                Source = p[4].Trim(),
                StrongDivisions = p.Length > 5
                    ? p[5].Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).ToList()
                    : new List<string>()
            });
        }
        return list;
    }

    /// <summary>Built-in table plus any user-added or user-overridden cities from state.</summary>
    public static List<MarketCity> Effective(AppState state)
    {
        var map = new Dictionary<string, MarketCity>(StringComparer.OrdinalIgnoreCase);
        foreach (var c in _builtIn) map[Key(c.City, c.State)] = c;
        foreach (var c in state.MarketExtras) map[Key(c.City, c.State)] = c;
        return map.Values.OrderBy(c => c.State).ThenBy(c => c.City).ToList();
    }

    public static MarketCity? Find(AppState state, string city, string st)
    {
        if (string.IsNullOrWhiteSpace(city)) return null;
        var k = Key(city, st);
        var hit = state.MarketExtras.FirstOrDefault(c => Key(c.City, c.State) == k)
               ?? _builtIn.FirstOrDefault(c => Key(c.City, c.State) == k);
        if (hit != null) return hit;

        // Fall back to a city-name match when the driver did not give a state.
        if (string.IsNullOrWhiteSpace(st))
        {
            return state.MarketExtras.FirstOrDefault(c => c.City.Equals(city.Trim(), StringComparison.OrdinalIgnoreCase))
                ?? _builtIn.FirstOrDefault(c => c.City.Equals(city.Trim(), StringComparison.OrdinalIgnoreCase));
        }
        return null;
    }

    /// <summary>Reset-capable markets, best positioned first relative to a destination state.</summary>
    public static List<MarketCity> ResetOptions(AppState state, string nearState, int take = 12)
    {
        var all = Effective(state).Where(c => c.ResetFriendly).ToList();
        return all
            .OrderBy(c => string.Equals(c.State, nearState, StringComparison.OrdinalIgnoreCase) ? 0 : 1)
            .ThenBy(c => c.Tier)
            .ThenBy(c => c.City)
            .Take(take)
            .ToList();
    }

    private static string Key(string city, string st) =>
        $"{city.Trim().ToLowerInvariant()}|{st.Trim().ToLowerInvariant()}";
}
