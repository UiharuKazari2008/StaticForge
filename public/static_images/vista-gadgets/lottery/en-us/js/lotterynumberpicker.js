// JavaScript Document

function determinedockingstate()
{
// chkdockedstate is the event called when we try to check the property

	System.Gadget.onUndock = chkdockedstate;
    System.Gadget.onDock = chkdockedstate;
}

// determine through a check which sizing function we should use

function chkdockedstate()
{
    if(System.Gadget.docked)
    {
		setTimeout("window.location.replace('lotterynumberpickerdocked.html')",0);
		System.Gadget.beginTransition();
		System.Gadget.endTransition(0, 0.05);
        document.body.style.width = "130px";
    	document.body.style.height = "137px";
    }
    else
    {
		setTimeout("window.location.replace('lotterynumberpickerundocked.html')",0);
		System.Gadget.beginTransition();
		System.Gadget.endTransition(0, 0.1);
        document.body.style.width = "250px";
    	document.body.style.height = "263px";
	}
}

function buttonsound()
{
	System.Gadget.beginTransition();
	System.Sound.playSound("\\Windows\\Media\\Windows Exclamation.wav");	
	System.Gadget.endTransition(0, 0.05);
}

determinedockingstate();

//Initialize randomnumber variables to 0 and then create randomnumber and check for duplicates
var randomnumber1 = 0;
var randomnumber2 = 0;
var randomnumber3 = 0;
var randomnumber4 = 0;
var randomnumber5 = 0;
var randomnumber6 = 0

randomnumber1 = Math.floor(Math.random()*56);
if(randomnumber1 == 0 || randomnumber1 == 1)
{
	randomnumber1 = "01";
}
if(randomnumber1 == 2)
{
	randomnumber1 = "02";
}
if(randomnumber1 == 3)
{
	randomnumber1 = "03";
}
if(randomnumber1 == 4)
{
	randomnumber1 = "04";
}
if(randomnumber1 == 5)
{
	randomnumber1 = "05";
}
if(randomnumber1 == 6)
{
	randomnumber1 = "06";
}
if(randomnumber1 == 7)
{
	randomnumber1 = "07";
}
if(randomnumber1 == 8)
{
	randomnumber1 = "08";
}
if(randomnumber1 == 9)
{
	randomnumber1 = "09";
}

randomnumber2 = Math.floor(Math.random()*56);
while(randomnumber2 == randomnumber1)
{
	randomnumber2 = Math.floor(Math.random()*56);
}
if(randomnumber2 == 0 || randomnumber2 == 1)
{
	randomnumber2 = "01";
}
if(randomnumber2 == 2)
{
	randomnumber2 = "02";
}
if(randomnumber2 == 3)
{
	randomnumber2 = "03";
}
if(randomnumber2 == 4)
{
	randomnumber2 = "04";
}
if(randomnumber2 == 5)
{
	randomnumber2 = "05";
}
if(randomnumber2 == 6)
{
	randomnumber2 = "06";
}
if(randomnumber2 == 7)
{
	randomnumber2 = "07";
}
if(randomnumber2 == 8)
{
	randomnumber2 = "08";
}
if(randomnumber2 == 9)
{
	randomnumber2 = "09";
}

randomnumber3 = Math.floor(Math.random()*56);
while(randomnumber3 == randomnumber2 || randomnumber3 == randomnumber1)
{
	randomnumber3 = Math.floor(Math.random()*56);
}
if(randomnumber3 == 0 || randomnumber3 == 1)
{
	randomnumber3 = "01";
}
if(randomnumber3 == 2)
{
	randomnumber3 = "02";
}
if(randomnumber3 == 3)
{
	randomnumber3 = "03";
}
if(randomnumber3 == 4)
{
	randomnumber3 = "04";
}
if(randomnumber3 == 5)
{
	randomnumber3 = "05";
}
if(randomnumber3 == 6)
{
	randomnumber3 = "06";
}
if(randomnumber3 == 7)
{
	randomnumber3 = "07";
}
if(randomnumber3 == 8)
{
	randomnumber3 = "08";
}
if(randomnumber3 == 9)
{
	randomnumber3 = "09";
}

randomnumber4 = Math.floor(Math.random()*56);
while(randomnumber4 == randomnumber3 || randomnumber4 == randomnumber2 || randomnumber4 == randomnumber1)
{
	randomnumber4 = Math.floor(Math.random()*56);
}
if(randomnumber4 == 0 || randomnumber4 == 1)
{
	randomnumber4 = "01";
}
if(randomnumber4 == 2)
{
	randomnumber4 = "02";
}
if(randomnumber4 == 3)
{
	randomnumber4 = "03";
}
if(randomnumber4 == 4)
{
	randomnumber4 = "04";
}
if(randomnumber4 == 5)
{
	randomnumber4 = "05";
}
if(randomnumber4 == 6)
{
	randomnumber4 = "06";
}
if(randomnumber4 == 7)
{
	randomnumber4 = "07";
}
if(randomnumber4 == 8)
{
	randomnumber4 = "08";
}
if(randomnumber4 == 9)
{
	randomnumber4 = "09";
}

randomnumber5 = Math.floor(Math.random()*56);
while(randomnumber5 == randomnumber4 || randomnumber5 == randomnumber3 || randomnumber5 == randomnumber2 || randomnumber5 == randomnumber1)
{
	randomnumber5 = Math.floor(Math.random()*56);
}
if(randomnumber5 == 0 || randomnumber5 == 1)
{
	randomnumber5 = "01";
}
if(randomnumber5 == 2)
{
	randomnumber5 = "02";
}
if(randomnumber5 == 3)
{
	randomnumber5 = "03";
}
if(randomnumber5 == 4)
{
	randomnumber5 = "04";
}
if(randomnumber5 == 5)
{
	randomnumber5 = "05";
}
if(randomnumber5 == 6)
{
	randomnumber5 = "06";
}
if(randomnumber5 == 7)
{
	randomnumber5 = "07";
}
if(randomnumber5 == 8)
{
	randomnumber5 = "08";
}
if(randomnumber5 == 9)
{
	randomnumber5 = "09";
}

randomnumber6 = Math.floor(Math.random()*43);
if(randomnumber6 == 0 || randomnumber6 == 1)
{
	randomnumber6 = "01";
}
if(randomnumber6 == 2)
{
	randomnumber6 = "02";
}
if(randomnumber6 == 3)
{
	randomnumber6 = "03";
}
if(randomnumber6 == 4)
{
	randomnumber6 = "04";
}
if(randomnumber6 == 5)
{
	randomnumber6 = "05";
}
if(randomnumber6 == 6)
{
	randomnumber6 = "06";
}
if(randomnumber6 == 7)
{
	randomnumber6 = "07";
}
if(randomnumber6 == 8)
{
	randomnumber6 = "08";
}
if(randomnumber6 == 9)
{
	randomnumber6 = "09";
}

//Sort the numbers
function sortNumber(a,b)
{
	return a - b;
}
var arr = new Array(5)
arr[0] = randomnumber1;
arr[1] = randomnumber2;
arr[2] = randomnumber3;
arr[3] = randomnumber4;
arr[4] = randomnumber5;

arr.sort(sortNumber);
	
	
	
	