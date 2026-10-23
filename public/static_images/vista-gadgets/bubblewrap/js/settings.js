//Stephan Hoefnagels, September 2006

var listColors = new Array("Teal", "Yellow", "Pink", "Blue", "Black", "White", "Camo", "Wood"); //Contains the colors of the swatches
var skinSetting; //Contains the current color
var skinIndex; //Contains the current color number in the listColors array

function loadSettings()
{
	//debug.innerHTML = "settings";
	defineSwatch(); //Define the swatches
	drawState(); //Draw the selection states in divs
	drawSwatches(); //Draw the colors and the hilites on top
	loadCurrentSettings(); //Load the current setting
	System.Gadget.onSettingsClosing = settingsClosing;
}

function swatchObject(color, state) //Define swatch object template
{
	this.color = color;
	this.state = state;
}

function defineSwatch()
{
	for (i in listColors)
	{
		listColors[i] = new swatchObject(listColors[i], "rest");
	}
}

function drawState()
{
	var stateHTML = ''; //HTML to draw the states
		for (i in listColors)
		{
		var mouseOver = "javascript:swatchOver("+i+");"; //events
		var mouseOut = "javascript:swatchOut("+i+");";
		var mouseUp = "javascript:swatchUp("+i+");";
 		var stateDefinition = '<div class="state" id="'+listColors[i].color+'State" title="'+listColors[i].color+'" onMouseOver='+mouseOver+' onMouseOut='+mouseOut+' onMouseUp='+mouseUp+' style="background-image:url(../images/rest.png)"></div>'; //Write the HTML
		stateHTML += stateDefinition;
		}
	swatchContainer.innerHTML = stateHTML;
}

function drawSwatches()
{
	for (i in listColors)
	{
	var colorImage = "../images/"+listColors[i].color+"Docked.png";
	var swatchDefinition = '<div class="swatch" id="'+listColors[i].color+'Swatch" style="background-image:url('+colorImage+')"><img src="../images/swatch.png"></div>'; //Write the HTML
	document.getElementById(listColors[i].color+"State").innerHTML += swatchDefinition;
	}
}

function swatchOver(i)
{
	var swatch = listColors[i];
	if (swatch.state == "rest")
	{
	document.getElementById(swatch.color+"State").style.backgroundImage="url(../images/hover.png)";
	}
	else
	{
	document.getElementById(swatch.color+"State").style.backgroundImage="url(../images/selected-hover.png)";
	}
}

function swatchOut(i)
{
	var swatch = listColors[i];
	if (swatch.state == "rest")
	{
	document.getElementById(swatch.color+"State").style.backgroundImage="url(../images/rest.png)";
	}
	else
	{
	document.getElementById(swatch.color+"State").style.backgroundImage="url(../images/selected.png)";
	}
}

function swatchUp(i)
{
	var swatch = listColors[i];
	if (swatch.state == "rest")
	{
	for (j in listColors)
	{
	document.getElementById(listColors[j].color+"State").style.backgroundImage="url(../images/rest.png)";
	listColors[j].state = "rest";
	}
	document.getElementById(swatch.color+"State").style.backgroundImage="url(../images/selected-hover.png)";
	swatch.state = "selected";
	}
	skinSetting = swatch.color;
	skinIndex = i;
}

function loadCurrentSettings()
{
	if (System.Gadget.Settings.read("SettingsExist"))
	{
		skinSetting = System.Gadget.Settings.read("skinSetting");
		skinIndex = System.Gadget.Settings.read("skinIndex");
	}
	else
	{
		skinSetting = listColors[0].color; //Default skin
		skinIndex = 0;
	}
	document.getElementById(skinSetting+"State").style.backgroundImage="url(../images/selected.png)"; //Show the current selection
	listColors[skinIndex].state = "selected";
}

function settingsClosing(event)
{
    if (event.closeAction == event.Action.commit)
    {
        saveSettings();
    }
}

function saveSettings()
{
    System.Gadget.Settings.write("skinSetting", skinSetting);
	System.Gadget.Settings.write("skinIndex", skinIndex);
    System.Gadget.Settings.write("SettingsExist", true);
}