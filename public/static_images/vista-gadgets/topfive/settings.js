 System.Gadget.onSettingsClosing=BC;
 function AA()
 {
   BD();
 }
 function AC()
 {
 }
 function BC(BF)
 {
   if(BF.closeAction==BF.Action.commit)BE();
   BF.cancel=false;
 }
 function BD()
 {
   AH();
 }
 function AH()
 {
   AU.value=System.Gadget.Settings.read("mod");
   Az.value=System.Gadget.Settings.read("back");
   var AX=System.Gadget.Settings.read("interval");
   if(AX!="")BG.value=AX;
 }
 function BE()
 {
   System.Gadget.Settings.write("mod",AU.value);
   System.Gadget.Settings.write("back",Az.value);
   System.Gadget.Settings.write("interval",BG.value);
}
