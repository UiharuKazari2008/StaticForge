//Stephan Hoefnagels, September 2006
//Woodgrain image from http://blog.imagereflex.com/images/2005/nature/woodgrain(050306NEF18).jpg

var bgImages = new Array(); //Contains the background images in g:background
var listPops = new Array(); //Contains the bubbles
var skin = ""; //Contains the skin

function loadGadget()
{	
	//debug.innerHTML = "Gadget";
	drawContent();
	System.Gadget.settingsUI = "Settings.html";
	System.Gadget.onSettingsClosed = settingsClosed;
	System.Gadget.onUndock = drawGadget;
    System.Gadget.onDock = drawGadget;
}

function settingsClosed(event)
{
	if (event.closeAction == event.Action.commit)
    {
		skin = System.Gadget.Settings.read("skinSetting");
		drawGadget();
	}
}

function drawGadget()
{
	clearGadget();
	var t=setTimeout("drawContent()",1); //HACK: to prevent distorted bubbles from showing up
}

function clearGadget()
{	
	bg.removeObjects();
	clearTimeout(); //NOTE: does this do anything?
	hot.innerHTML ='';
}

function drawContent()
{
	//CHECK SKIN
	skin = System.Gadget.Settings.read("skinSetting");
	if (skin == "")
	{
		 skin = "Teal"; //Default skin
	}

	//DRAW SKIN
    if(System.Gadget.docked)
	{
		var width = 130;
		var height = 130;
		var offset = 2;
		var img = "../images/bg-docked.png";
		var skinImg = skin +"Docked";
	}
	else
	{
		var width = 409;
		var height = 284;
		var offset = 13;
		var img = "../images/bg-floating.png";
		var skinImg = skin;
	}
	document.body.style.width = ""+width+"px"; //Size the gadget
	document.body.style.height = ""+height+"px";
	bgImages[0] = bg.addImageObject("../images/"+skinImg+".png", offset, offset); //Add skin img. NOTE: ideally this would be loaded in g:background html, but unable to get positioning to work there.
	bgImages[1] = bg.addImageObject(img, 0, 0); //Add img with hilites

	//DRAW POPS
	var hotHTML = ''; //HTML to draw the hot areas
	var j = 0 //alternating x offset per row: 0 for odd rows, 1 for even
	var k = 0 //incrementing y offset per row
	var l = 0 //reset to starting x position per row
	
	if(System.Gadget.docked)
	{
		var popNu = 20;
		var arrayLineBreaks = new Array(3,5,8,10,13,15,18);
		var xMargin = 4;
		var yMargin = 2;
		var popReturn = 2000;
	}
	else
	{
		var popNu = 128;
		var arrayLineBreaks = new Array(8,15,23,30,38,45,53,60,68,75,83,90,98,105,113,120);
		var xMargin = 17;
		var yMargin = 13;
		var popReturn = 12000;
	}
	for (i = 0; i < popNu; i++)
	{		
		for (m in arrayLineBreaks) //Line breaks
		{
			if (i == arrayLineBreaks[m])
			{
				k++;
				l = i*48;
					if (j == 0) //even
					{
						j = 1;
					}
					else
					{
						j = 0;
					}
				break;
			}
		}
		//Draw the bubbles in g:background
		var locx = xMargin + j*24 + i*48 - l;
		var locy = yMargin + k*14;
		var popImg = getRandomPop(); //Get 1 out of 3 pop images
		listPops[i] = bg.addImageObject("../images/up"+skin+"-"+popImg+".png", locx, locy);

		//Draw the hot areas in divs
		var hotId = 'hot_'+i; //div id
		var hotLeft = listPops[i].left + 1; //position, prevent the hot areas from overlapping
		var hotTop = listPops[i].top + 1;
		var mouseOver = "javascript:popHover("+i+");"; //events
		var mouseOut = "javascript:timer("+i+","+popReturn+");";

		var hotDefinition = '<div id="'+hotId+'" style="position:absolute;left:'+hotLeft+'px;top:'+hotTop+'px;width:24px;height:24px" onMouseOver='+mouseOver+'  onMouseOut='+mouseOut+'></div>'; //Write the HTML
				
		hotHTML += hotDefinition;
	}
	hot.innerHTML = hotHTML;
	popGadget(); //pop some random bubbles after drawing
}

function popHover(pop)
{
	if (listPops[pop].src = "../images/up.png") //only pop if the pop is up
	{
		listPops[pop].src = "../images/down.png";
		System.Sound.playSound("../sounds/Windows Balloon.wav");
	}
}

function timer(pop,popReturn)
{
	var t=setTimeout("popOut("+pop+")",popReturn)
}

function popOut(pop)
{
	var popImg = getRandomPop();
	listPops[pop].src = "../images/up"+skin+"-"+popImg+".png";
	//System.Sound.playSound("../sounds/Windows Menu Command.wav");
}

function getRandomPop()
{
	var popImg = Math.floor(Math.random()*3);
	return popImg;
}

function popGadget()
{
	for (i=0;i<20;i++)
	{
		var pop = Math.floor(Math.random()*listPops.length); //NOTE: some pops will get this event more than once
		var popReturn = Math.floor(Math.random()*2000)+1000; //Randomly pop the bubbles back
		popHover(pop);
		timer(pop, popReturn);
	}
}