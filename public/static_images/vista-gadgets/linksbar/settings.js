
    
    // const
    var folderPrompt = "[select]";
    
    function SettingsDocLoaded()
    {    
       System.Gadget.onSettingsClosing = SettingsClosing;
        
       // Load settings
       var v = System.Gadget.Settings.read("title");              
       document.getElementById("title").value = (v == "" ? "Links" : v);
       v = System.Gadget.Settings.read("folder");
       document.getElementById("folder").innerText = (v == "" ? folderPrompt : v);;
    }
    
    function SettingsClosing(e)
    {
      if (e.closeAction != e.Action.commit)
         return;
            
      // Save settings
      System.Gadget.Settings.write("title", document.getElementById("title").value);
      var v = document.getElementById("folder").innerText;
      System.Gadget.Settings.write("folder", (v == folderPrompt ? "" : v));
    }

    function SelectFolder()
    {
        var fld = System.Shell.chooseFolder("Select Folder containing shortcuts and/or links", 0);
        document.getElementById("folder").innerText = (fld == null ? folderPrompt : fld.path);        
    }
