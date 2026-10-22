//variables
var _bIntervalsSet          = false;
var _RefreshInterval        = 600; //seconds //3600 = 1 hours
var _RefreshIntervalID;
var xmlDoc = new ActiveXObject("Microsoft.XMLDOM");
var rss_selected = 0;
System.Gadget.settingsUI = "settings.html";    

function first()
{
xmlFile = "http://earthquake.usgs.gov/eqcenter/recenteqsww/catalogs/eqs1day-M2.5.xml";
xmlDoc.async = "false";
xmlDoc.load (xmlFile);
xmlObj = xmlDoc.documentElement;
ClearRefreshIntervals()
get_rss()
//check if need to check for new update
var d = new Date()
currentdate=d.getDate() + " - " + d.getDay()
if (document.getElementById("lastupdate").innerText!=currentdate)
{checkforupdate()}
}
function get_rss()
{   
	if (xmlDoc.parseError != "0")
	{
		alert ("Error Connecting To Website");
	}
	else
	{
		for (i = 0; i < 10; i++)
		{
			document.getElementById("rss" + i).innerHTML = "<a href=\"\" onclick=\"more_rss_info(" + i + "); return false;\">" + xmlDoc.getElementsByTagName("item")[i].getElementsByTagName("title")[0].text + "</a>";
		}
	}
    SetRefreshIntervals()
}

function show_flyout(filename)
{
	System.Gadget.Flyout.file = filename + ".html";
	System.Gadget.Flyout.show = true;
}

function more_rss_info(i)
{
	show_flyout('rss-flyout');
	rss_selected = i;
}

function SetRefreshIntervals() { // Activate the timer
if (_bIntervalsSet == false)
{_RefreshIntervalID = setInterval(first, 1000 * _RefreshInterval);
_bIntervalsSet = true;}}

function ClearRefreshIntervals() { // Deactivate the timer
if (_bIntervalsSet == true)
{clearInterval(_RefreshIntervalID);
_bIntervalsSet = false;}
}
function checkforupdate() //get update xml
{
var xmlDoc = new ActiveXObject("Microsoft.XMLDOM");
xmlFile="http://earthquake.usgs.gov/eqcenter/recenteqsww/catalogs/eqs1day-M2.5.xml";
xmlDoc.async="false";
xmlDoc.load(xmlFile);
xmlObj=xmlDoc.documentElement; 

//set last update date
var d = new Date()
currentdate=d.getDate() + " - " + d.getDay()
document.lastupdate=currentdate
}