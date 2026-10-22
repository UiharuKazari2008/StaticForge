var amount;
var result;

function trim(stringToTrim)
{
	return stringToTrim.replace(/^\s+|\s+$/g,"");
}

function calc()
{
    document.selection.empty();
    
    if (trim(document.loveform.name1.value) == "") 
    {
        document.loveform.name1.value = "<Your name>";
    }
    if (trim(document.loveform.name2.value) == "") 
    {
        document.loveform.name2.value = "<Your lover's name>";
    }
    
    first = document.loveform.name1.value.toUpperCase();
    if (first == "<YOUR NAME>")
    {
        selectname1();
        return;
    }        
    firstlength = document.loveform.name1.value.length;
    
    second = document.loveform.name2.value.toUpperCase();
    if (second == "<YOUR LOVER'S NAME>")
    { 
        selectname2();
        return;
    }
    secondlength = document.loveform.name2.value.length;
    var LoveCount=0;
    var i=0;

    for (Count=0; Count < firstlength; Count++)
    {
        letter1=first.substring(Count,Count+1);
        if (letter1=='V') LoveCount+=2;
        if (letter1=='A') LoveCount+=2;
        if (letter1=='L') LoveCount+=2;
        if (letter1=='E') LoveCount+=2;
        if (letter1=='N') LoveCount+=2;
        if (letter1=='T') LoveCount+=2;
        if (letter1=='I') LoveCount+=2;
        if (letter1=='N') LoveCount+=2;
        if (letter1=='E') LoveCount+=2;            
    }

    for (Count=0; Count < secondlength; Count++)
    {
        letter2=second.substring(Count,Count+1);
        if (letter2=='V') LoveCount+=2;
        if (letter2=='A') LoveCount+=2;
        if (letter2=='L') LoveCount+=2;
        if (letter2=='E') LoveCount+=2;
        if (letter2=='N') LoveCount+=2;
        if (letter2=='T') LoveCount+=2;
        if (letter2=='I') LoveCount+=2;
        if (letter2=='N') LoveCount+=2;
        if (letter2=='E') LoveCount+=2;
    }

    amount=0;
    result=0;
    
    amount = (LoveCount / (2 * (firstlength+secondlength))) * 100
    amount = Math.round(amount);
    
    if (firstlength==0 || secondlength==0) amount= 0;
    if (amount < 0) amount= 0;
    if (amount >99) amount=99;
    
    display();
}

function display()
{
    document.loveform.output.value = result + "%";
    if (result < amount)
    {
        result = result + 1;
        setTimeout("display()",50)
    }
}   

function selectname1()
{
    document.loveform.name1.focus();document.loveform.name1.select();
}
function deselectname1()
{
    document.loveform.name1.focus();document.loveform.name1.select();
}

function selectname2()
{
    document.loveform.name2.focus();document.loveform.name2.select();
}
function deselectname2()
{
    document.loveform.name2.focus();document.loveform.name2.select();
}

function onkeydown1()
{
    if (event.keyCode == 13)
    {
        selectname2();
        event.returnValue=false;
    }
}

function onkeydown2()
{
    if (event.keyCode == 13)
    {
        calc();
        event.returnValue=false;
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

function init()
{
    checkState();
    System.Gadget.onUndock = checkState;
    System.Gadget.onDock = checkState;
    selectname1();
}

function undockedState()
{
    with(document.body.style)
        width=130, 
        height=130;   
    document.body.style.backgroundImage= "url(heart.png)";
    System.Gadget.background="url(heart.png)";
}

function dockedState()
{   
   
    with(document.body.style)
        width=130,
        height=130;  
    document.body.style.backgroundImage= "url(heart.png)";
    System.Gadget.background="url(heart.png)";
}