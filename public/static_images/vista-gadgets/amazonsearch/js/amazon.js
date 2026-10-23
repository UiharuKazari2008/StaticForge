var AmazonSearchURL;
var L_AmazonSearchTxt_jaES = "";
var L_AmazonSearchURL_jaES = "";
var refURL  = "";
var shell = new ActiveXObject('WScript.Shell');	

function launchSearch()
{
    if (document.getElementById("srchBox").value != "")
    {
        var userInput = document.getElementById("srchBox").value;
        var processedString = encodeURIComponent(userInput);
		var sServer ="http://www.amazon.com";
    	var url = sServer +"/s/?tag=a09490-20&creative=392013&campaign=212361&link_code=wsw&_encoding=UTF-8&search-alias=aps&field-keywords=" + processedString + AmazonSearchURL;
		shell.Run(url);
    }
}

function cksearchText(o)
{
    if (o.value == "")
    {
        searchText.style.display = "";
    }
    else
    {
        searchText.style.display = "none";
    }
}

function doSearchOnEnter()
{
    if (window.event.keyCode== 13)
    {
        launchSearch();
    }
}

function procSettingsClosedEvent(event)
{
   if (event.closeAction == event.Action.commit) {
       loadMain();
   }
}

function checkState()
{
    if(!System.Gadget.docked) 
    {
        undockedState();
    } 
    else if (System.Gadget.docked)
    {
        dockedState(); 
    }
}

function undockedState()
{

    with(document.body.style)
        width=260;
	with(slideshowBg.style)
        width=260;
	with(searchBox.style)
		width=230;
	with(button.style)
		left=230;
	
	slideshowBg.src="url(images/background2.png)";

}
////////////////////////////////////////////////////////////////////////////////
//
// styles for gadget when DOCKED
// 
////////////////////////////////////////////////////////////////////////////////
function dockedState()
{   
    with(document.body.style)
        width=130;
	with(slideshowBg.style)
        width=130;
	with(searchBox.style)
		width=100;
	with(button.style)
		left=107;
     
	slideshowBg.src="url(images/background.png)";
}