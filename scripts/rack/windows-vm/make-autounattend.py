# Writes unat/autounattend.xml for win11-template (reads the rack password from ~/.secrets/win11-rack.pass; the XML holds it: keep the output off git and delete the unattend ISO after the install).
import os
pw=open(os.path.expanduser('~/.secrets/win11-rack.pass')).read().strip()
KEY='NPPR9-FWDCX-D2C8J-H872K-2YT43'
paths=''
n=1
for L in 'DEFGHI':
    for d in ('viostor','vioscsi','NetKVM','vioserial','Balloon','viorng','vioinput','viogpudo','qxldod'):
        paths+=f'<PathAndCredentials wcm:action="add" wcm:keyValue="{n}"><Path>{L}:\\{d}\\w11\\amd64</Path></PathAndCredentials>\n'
        n+=1
x=f'''<?xml version="1.0" encoding="utf-8"?>
<unattend xmlns="urn:schemas-microsoft-com:unattend" xmlns:wcm="http://schemas.microsoft.com/WMIConfig/2002/State">
<settings pass="windowsPE">
 <component name="Microsoft-Windows-International-Core-WinPE" processorArchitecture="amd64" publicKeyToken="31bf3856ad364e35" language="neutral" versionScope="nonSxS">
  <SetupUILanguage><UILanguage>en-US</UILanguage></SetupUILanguage>
  <InputLocale>en-US</InputLocale><SystemLocale>en-US</SystemLocale><UILanguage>en-US</UILanguage><UserLocale>en-US</UserLocale>
 </component>
 <component name="Microsoft-Windows-PnpCustomizationsWinPE" processorArchitecture="amd64" publicKeyToken="31bf3856ad364e35" language="neutral" versionScope="nonSxS">
  <DriverPaths>
{paths}  </DriverPaths>
 </component>
 <component name="Microsoft-Windows-Setup" processorArchitecture="amd64" publicKeyToken="31bf3856ad364e35" language="neutral" versionScope="nonSxS">
  <RunSynchronous>
   <RunSynchronousCommand wcm:action="add"><Order>1</Order><Path>reg add HKLM\\SYSTEM\\Setup\\LabConfig /v BypassTPMCheck /t REG_DWORD /d 1 /f</Path></RunSynchronousCommand>
   <RunSynchronousCommand wcm:action="add"><Order>2</Order><Path>reg add HKLM\\SYSTEM\\Setup\\LabConfig /v BypassSecureBootCheck /t REG_DWORD /d 1 /f</Path></RunSynchronousCommand>
   <RunSynchronousCommand wcm:action="add"><Order>3</Order><Path>reg add HKLM\\SYSTEM\\Setup\\LabConfig /v BypassCPUCheck /t REG_DWORD /d 1 /f</Path></RunSynchronousCommand>
   <RunSynchronousCommand wcm:action="add"><Order>4</Order><Path>reg add HKLM\\SYSTEM\\Setup\\LabConfig /v BypassRAMCheck /t REG_DWORD /d 1 /f</Path></RunSynchronousCommand>
  </RunSynchronous>
  <DiskConfiguration>
   <Disk wcm:action="add"><DiskID>0</DiskID><WillWipeDisk>true</WillWipeDisk>
    <CreatePartitions>
     <CreatePartition wcm:action="add"><Order>1</Order><Type>EFI</Type><Size>100</Size></CreatePartition>
     <CreatePartition wcm:action="add"><Order>2</Order><Type>MSR</Type><Size>16</Size></CreatePartition>
     <CreatePartition wcm:action="add"><Order>3</Order><Type>Primary</Type><Extend>true</Extend></CreatePartition>
    </CreatePartitions>
    <ModifyPartitions>
     <ModifyPartition wcm:action="add"><Order>1</Order><PartitionID>1</PartitionID><Format>FAT32</Format><Label>System</Label></ModifyPartition>
     <ModifyPartition wcm:action="add"><Order>2</Order><PartitionID>2</PartitionID></ModifyPartition>
     <ModifyPartition wcm:action="add"><Order>3</Order><PartitionID>3</PartitionID><Format>NTFS</Format><Label>Windows</Label><Letter>C</Letter></ModifyPartition>
    </ModifyPartitions>
   </Disk>
  </DiskConfiguration>
  <ImageInstall><OSImage>
   <InstallTo><DiskID>0</DiskID><PartitionID>3</PartitionID></InstallTo>
   <InstallToAvailablePartition>false</InstallToAvailablePartition>
   <InstallFrom><MetaData wcm:action="add"><Key>/IMAGE/INDEX</Key><Value>1</Value></MetaData></InstallFrom>
  </OSImage></ImageInstall>
  <UserData><AcceptEula>true</AcceptEula><FullName>rack</FullName><Organization>Dreamscape</Organization></UserData>
 </component>
</settings>
<settings pass="specialize">
 <component name="Microsoft-Windows-Shell-Setup" processorArchitecture="amd64" publicKeyToken="31bf3856ad364e35" language="neutral" versionScope="nonSxS">
  <ProductKey>{KEY}</ProductKey>
  <ComputerName>WIN11-TPL</ComputerName>
  <TimeZone>UTC</TimeZone>
 </component>
 <component name="Microsoft-Windows-Deployment" processorArchitecture="amd64" publicKeyToken="31bf3856ad364e35" language="neutral" versionScope="nonSxS">
  <RunSynchronous>
   <RunSynchronousCommand wcm:action="add"><Order>1</Order><Path>reg add HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\OOBE /v BypassNRO /t REG_DWORD /d 1 /f</Path></RunSynchronousCommand>
  </RunSynchronous>
 </component>
</settings>
<settings pass="oobeSystem">
 <component name="Microsoft-Windows-International-Core" processorArchitecture="amd64" publicKeyToken="31bf3856ad364e35" language="neutral" versionScope="nonSxS">
  <InputLocale>en-US</InputLocale><SystemLocale>en-US</SystemLocale><UILanguage>en-US</UILanguage><UserLocale>en-US</UserLocale>
 </component>
 <component name="Microsoft-Windows-Shell-Setup" processorArchitecture="amd64" publicKeyToken="31bf3856ad364e35" language="neutral" versionScope="nonSxS">
  <OOBE><HideEULAPage>true</HideEULAPage><HideOnlineAccountScreens>true</HideOnlineAccountScreens><HideWirelessSetupInOOBE>true</HideWirelessSetupInOOBE><ProtectYourPC>3</ProtectYourPC><SkipMachineOOBE>true</SkipMachineOOBE><SkipUserOOBE>true</SkipUserOOBE></OOBE>
  <UserAccounts><LocalAccounts><LocalAccount wcm:action="add"><Name>rack</Name><Group>Administrators</Group><DisplayName>rack</DisplayName>
   <Password><Value>{pw}</Value><PlainText>true</PlainText></Password></LocalAccount></LocalAccounts></UserAccounts>
  <AutoLogon><Enabled>true</Enabled><LogonCount>2</LogonCount><Username>rack</Username><Password><Value>{pw}</Value><PlainText>true</PlainText></Password></AutoLogon>
  <FirstLogonCommands>
   <SynchronousCommand wcm:action="add"><Order>1</Order><Description>rack setup</Description>
    <CommandLine>cmd /c for %d in (D E F G H I J) do if exist %d:\\setup.ps1 powershell -NoProfile -ExecutionPolicy Bypass -File %d:\\setup.ps1</CommandLine></SynchronousCommand>
  </FirstLogonCommands>
 </component>
</settings>
</unattend>
'''
open('unat/autounattend.xml','w').write(x)
