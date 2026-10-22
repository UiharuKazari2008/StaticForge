// JScript File
    
    var content;
    
    function CreateAnchor(name, uri)
    {        
      var a = document.createElement("a");
      a.href = uri;
      a.title = uri;
      a.innerHTML = name;
      return a;
    }
    
    function AddLink(name, uri)
    {
       var div = document.createElement("div");
       content.appendChild(div);           
       div.className = "LinkDiv";
       
       /*
       var item = System.Shell.itemFromPath(uri);
       if (item.type != "")              
       {
           System.Debug.outputString(uri);
          
           var img = document.createElement("img");
           img.src = "gImage:///" + uri + "?width=20&height=20";
           div.appendChild(img);
       }
       */
       
       div.appendChild(CreateAnchor(name, uri));                  
    }
    
    
    function Refresh()
    {
      // clear current contents
       content.innerHTML = "";
    
       var title = System.Gadget.Settings.read("title");
       if (title == "")
          title = "Links";
          
       document.getElementById("title").innerText = title; 
    
       var folderPath = System.Gadget.Settings.read("folder");
       if (folderPath == "")
         folderPath = System.Shell.knownFolderPath("Profile") + "\\Favorites\\Links";                                       
       
       // System.Shell.Folder.parse does not seem to work!!
       var folder = System.Shell.itemFromPath(folderPath).SHFolder;
       var count = folder.Items.count;
       for (i=0; i < count; i++)
       {
         var item = folder.Items.item(i); 
         // Note: item.IsFile does not work, but item.isFolder does.
         if (!item.isFolder && item.isLink)             
            AddLink(item.name, item.link.path);             
       }
    }
    
    function MainDocLoaded()
    {
       // init global vars
       content = document.getElementById("content"); 
       System.Gadget.settingsUI = "Settings.htm";
       System.Gadget.onSettingsClosed = Refresh;

       Refresh();
    }

