<!--
window.onload = function () 
{
	var oLg = document.getElementById('oLength');
	for(i=4;i<=20;i++)
	{
		var	oOp = document.createElement('OPTION');
		oLg.appendChild(oOp);
		oOp.value = i;
		oOp.innerText = i;
		if(i==10)
			oOp.selected = 'selected';
	}
}
function GeneratePassword()
{
	var oPw = document.getElementById('oPassword');
	var oPh = document.getElementById('oPhrase');
	var oLg = document.getElementById('oLength');
	var lts = new Array();
	var r	= "";
	var pLen = 0;
	
	oPw.innerText = '';
			
	if(oPh.value=='' || oPh.value==null)
	return false;
	
	var a = oPh.value.split(''); 
	var p = '';
	for(i=0;i<a.length;i++) {
		n = a[i].toLowerCase();
		switch(n) {
			case ' ':p+='';break;
			case 'e':p+='3';break;
			case 't':p+='+';break;
			case 'a':p+='4';break;
			case 'g':p+='9';break;
			case 'l':p+='1';break;
			case 'b':p+='8';break;
			case 's':p+='5';break;
			case 'z':p+='2';break;
			case 'b':p+='8';break;
			case 'o':p+='0';break;
			case 'x':p+='*';break;
			case 'c':p+='[';break;
			case 'd':p+=']';break;
			default:
			if(i%2==0)
			p+=n;
			else
			p+=n.toUpperCase();
		}
	}
	c=p.length;
	w=c/oLg.value;
	var k='';
	for(i=0;i<=c;i+=w) {
	k+=p.substr(i,1);
	if(k.length>=oLg.value) 
	break;
	}
	oPw.innerText = k;
}

		var col = "";
		var opa = "";
		    
        System.Gadget.settingsUI = "settings.html";
        System.Gadget.onSettingsClosed = settingsClosed;
        function applySerrings()
        {
			b =	document.getElementById('bg');
			b.src = 'images/bg' + col + '.png';
			b.opacity = opa;
        }
		
        function settingsClosed(event)
        {
        	if (event.closeAction == event.Action.commit)
			{
				col = System.Gadget.Settings.read("colorTheme");
				opa = System.Gadget.Settings.read("bgOpacity");
				applySerrings();
			}
        }

-->
	