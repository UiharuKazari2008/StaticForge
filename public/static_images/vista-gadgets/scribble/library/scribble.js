//---------------------------------------------
//  THIS CODE IS NOT APPROVED FOR USE IN/ON ANY OTHER UI ELEMENT OR PRODUCT COMPONENT.  
//  Copyright (c) 2006 Microsoft Corporation.  All rights reserved.
// ---------------------------------------------- 
daBar(bar);

String.prototype.dup=function(n){with([]){length=n+1;return join(this)}}
var fso=new ActiveXObject("Scripting.FileSystemObject");

var dockedWidth = 131;
var dockedHeight = 133;

var unDockedWidth = 258;
var unDockedHeight = 204;

var unDockedCanvasWidth = 244;
var unDockedCanvasHeight = 175;

var dockedCanvasWidth = 115;
var dockedCanvasHeight = 188;

setTimeout('loadGadget()',1000);


function loadGadget()
{
    daCanvas(canv,unDockedCanvasWidth,unDockedCanvasHeight).load();
    timer_control.onclick=canv.save;
    shuffle_control.onclick=canv.cls;
    loadingMsg.style.display = "none"; 
}

try
{
    System.Gadget.onDock=Dock;
    System.Gadget.onUndock=unDock;
    window.onload=System.Gadget.docked?Dock:unDock;
}
catch(err)
{
    window.onload=function reDock()
    {
        document.body.offsetHeight<=258?Dock():unDock();
    }
    window.onresize=function()
    {
        clearTimeout(this.tmz);
        this.tmz=setTimeout(reDock,100);
    }
}

function Dock(){
    
    with(document.body.style)
        width=dockedWidth,
        height=dockedHeight,
        backgroundImage="url(images/chalkboard_floating_small.png)";
        
    canv.style.width = dockedCanvasWidth;
    canv.runtimeStyle.cssText="width:"+(dockedCanvasWidth-50)+";height:"+dockedCanvasHeight-10;

    barTitle.style.width = dockedWidth-12;

    bar.style.left = 8;
    bar.style.top = 4;
}

function unDock(){
    with(document.body.style)
        width=unDockedWidth,
        height=unDockedHeight,
        backgroundImage="url(images/chalkboard_background.png)";
        
    canv.runtimeStyle.cssText="left:5;top:8;width:"+unDockedCanvasWidth+";height:"+unDockedCanvasHeight;
    
    bar.style.left = 8;
    bar.style.top = 4;
    barTitle.style.width = unDockedWidth+10;
};


function daCanvas(o,pixw,pixh){
    
    var colors={f:"#ffffff",a:"#aaaaaa"};

   canv.innerHTML=("<div nowrap>"+"<img>".dup(pixw)+"</div>").dup(pixh);

    o.pset=function pset(x,y,color)
    {
        var row=o.children[y],pix;
        if(row && (pix=row.children[x]))
            pix.style.backgroundColor=color;
    };
    
    o.cls=function()
    {
        for(var a=o.all.tags("IMG"),i=0,pix; pix=a[i]; i++)
            pix.style.backgroundColor="";
    };
    
    o.onmousedown=function()
    {
        o.setCapture();
        o.onmousemove=function omm()
        {
            if (event.shiftKey)
            {
                var ew=2;
                
                for(var ey=-ew; ey<=ew; ey++)
                    for(var ex=-ew; ex<=ew; ex++)
                        pix("",ex,ey);
            }
            else
            {
                pix(colors.a,0,-1); 
                pix(colors.a,-1,0); 
                pix(colors.f,0, 0); 
                pix(colors.a, 1,0);
                pix(colors.a,0, 1);
            } 
            
            function pix(color,dx,dy)
            {
                var ox=event.clientX-o.offsetLeft+dx,
                    oy=event.clientY-o.offsetTop+dy,
                    pix;
                if (1)
                {
                    pset(ox,oy,color);
                }
                else
                {
                    setTimeout(o.uniqueID+".pset("+ox+","+oy+",'"+color+"')",25);
                }
            }
        }
        o.onmouseup=function()
        {
            o.releaseCapture();
            o.onmousemove = o.onmouseup=null;
        }
        omm();
    };
    
    o.load=function()
    {
        try
        {
            var s=sav(true).ReadAll();
            
            if(s.length==pixw*pixh)
                for(var a=o.all.tags("IMG"),i=0,pix; pix=a[i]; i++)
                    pix.style.backgroundColor=colors[s.charAt(i)];
        }
        catch(err)
        {
            alert(err.description);
        }
    };   
     
    o.save=function()
    {
        var ac=[];
        for(var a=o.all.tags("IMG"),i=0,pix,c; pix=a[i]; i++)
        {
            c=pix.style.backgroundColor.charAt(1);
            ac.push(c?c:"-");
        }
        
        try
        {
            with(sav(false))
                Write(ac.join("")),Close();
        }
        catch(err)
        {
            alert(err.description);
        }
    };    
        
    function sav(readOnly)
    {
        var fn="scribble.sav";
        
        try
        {
            fn=fso.BuildPath(System.Gadget.path,fn);
        }
        catch(err)
        {
            fn=fso.BuildPath(unescape(fso.GetParentFolderName(location.pathname.substr(1))),fn);
        }
        
        return readOnly?fso.OpenTextFile(fn):fso.CreateTextFile(fn,true);
    }
    
    return o;
}

//
function daBar(o)
{
    var a=o.all.tags("IMG"),
        i=0,
        img;
        
    while(img=a[i++])
    {
        with(img)
        {
            src="images/"+id+"_rest.png";
            onmouseover=function(){this.hover=true;fix(this)}
            onmouseout =function(){this.hover=false;fix(this)}
            onmousedown=function(){this.pressed=true;fix(this);this.setCapture()}
            onmouseup  =function()
            {
                this.releaseCapture()
                this.pressed=false;
                var e=document.elementFromPoint(event.clientX,event.clientY);
                if(e!=this){
                    this.hover=false;
                    e.fireEvent("onmouseover");
                }
                fix(this);
            }
            function fix(e)
            {
                e.src="images/"+e.id+"_"+(e.disabled?"disabled":e.pressed?"pressed":e.hover?"hover":"rest")+".png";                
            }
        }
    }
}

document.onselectstart=document.ondragstart=document.oncontextmenu=function()
{
    return false;
}

// SIDEBAR CODE BELOW

    System.Gadget.onDock=Dock;
    System.Gadget.onUndock=unDock;