
var imageCount = 10;
var imageIndex = 0;
var imageSize = "_s";

function takeBite() {
	imageIndex++;
	
	if (imageIndex<10)
	{
		if (imageIndex>8)
		{
			
			 bar.style.backgroundImage="url(images/recycle_r"+imageSize+".png)";
		}	
		
		document.body.style.backgroundImage= "url(images/snack_"+imageIndex+imageSize+".png)";
	
		var crunch_number=Math.floor(Math.random()*6); 
		System.Sound.playSound('../images/crunch'+crunch_number+'.wav')
	}
	else
	{
		System.Sound.playSound('../images/recycle.wav')
		System.Gadget.close();
	}	
}







////////////////////////////////////////////////////////////////////////////////
function showBar()
{
  if(event.fromElement)
    {
        return;
    }
    clearTimeout(bar.timer);
    up();
    function up()
    {
        with(bar.filters("alpha"))
        {
            if((opacity+=15)<75)
            {
                bar.timer=setTimeout(up,25);
            }
            else
            {
                opacity=75;
            }
        }
    }
}

////////////////////////////////////////////////////////////////////////////////
function hideBar()
{
    if(event.toElement)
    {
        return;
    }
    clearTimeout(bar.timer);
    down();
    function down()
    {
        with(bar.filters("alpha"))
        {
            if((opacity-=15)>0)
            {
                bar.timer=setTimeout(down,25);
            }
            else
            {
                opacity=0;
            }
        }
    }
}

////////////////////////////////////////////////////////////////////////////////
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
////////////////////////////////////////////////////////////////////////////////
function loadMain()
{
    System.Sound.playSound('../images/crunch1.wav')    
    checkState();
    System.Gadget.onUndock = checkState;
    System.Gadget.onDock = checkState;

}

////////////////////////////////////////////////////////////////////////////////
function undockedState()
{
    with(document.body.style)
        width=230, 
        height=230;   
   	imageSize = "_l";
	document.body.style.backgroundImage= "url(images/snack_"+imageIndex+imageSize+".png)";
    System.Gadget.background="url(images/snack_"+imageIndex+imageSize+".png)";
    with(bar.style)
    	backgroundImage="url(../images/eat_r_l.png)",
        width=30,
        height=30,
        top=170,
        left=99;  
}

////////////////////////////////////////////////////////////////////////////////
function dockedState()
{   
   
    with(document.body.style)
        width=130,
        height=130;  
    imageSize = "_s";
    document.body.style.backgroundImage= "url(images/snack_"+imageIndex+imageSize+".png)";
    System.Gadget.background="url(images/snack_"+imageIndex+imageSize+".png)";
    with(bar.style)
    	backgroundImage="url(../images/eat_r_s.png)",
        width=18,
        height=18,
        top=95,
        left=56;
}
