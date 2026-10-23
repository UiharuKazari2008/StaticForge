arrExcuses = Array( _
    "clock speed", _
    "solar flares", _
    "electromagnetic radiation from satellite debris", _
    "static from nylon underwear", _
    "static from plastic slide rules", _
    "global warming", _
    "poor power conditioning", _
    "static buildup", _
    "doppler effect", _
    "hardware stress fractures", _
    "magnetic interferance from money/credit cards", _
    "dry joints on cable plug", _
    "we're waiting for [the phone company] to fix that line", _
    "sounds like a Windows problem, try calling Microsoft support", _
    "temporary routing anomoly", _
    "somebody was calculating pi on the server", _
    "fat electrons in the lines", _
    "excess surge protection", _
    "floating point processor overflow", _
    "divide-by-zero error", _
    "POSIX complience problem", _
    "monitor resolution too high", _
    "improperly oriented keyboard", _
    "network packets travelling uphill (use a carrier pigeon)", _
    "Decreasing electron flux", _
    "first Saturday after first full moon in Winter", _
    "radiosity depletion", _
    "CPU radiator broken", _
    "It works the way the Wang did, what's the problem", _
    "positron router malfunction", _
    "cellular telephone interference", _
    "techtonic stress", _
    "pizeo-electric interference", _
    "(l)user error", _
    "working as designed", _
    "dynamic software linking table corrupted", _
    "heavy gravity fluctuation, move computer to floor rapidly", _
    "secretary plugged hairdryer into UPS", _
    "terrorist activities", _
    "not enough memory, go get system upgrade", _
    "interrupt configuration error", _
    "spaghetti cable cause packet failure", _
    "boss forgot system password", _
    "bank holiday - system operating credits  not recharged", _
    "virus attack, luser responsible", _
    "waste water tank overflowed onto computer", _
    "Complete Transient Lockout", _
    "bad ether in the cables", _
    "Bogon emissions", _
    "Change in Earth's rotational speed", _
    "Cosmic ray particles crashed through the hard disk platter", _
    "Smell from unhygenic janitorial staff wrecked the tape heads", _
    "Little hamster in running wheel had coronary; waiting for replacement to be Fedexed from Wyoming", _
    "Evil dogs hypnotized the night shift", _
    "Plumber mistook routing panel for decorative wall fixture", _
    "Electricians made popcorn in the power supply", _
    "Groundskeepers stole the root password", _
    "high pressure system failure", _
    "failed trials, system needs redesigned", _
    "system has been recalled", _
    "not approved by the FCC", _
    "need to wrap system in aluminum foil to fix problem", _
    "not properly grounded, please bury computer", _
    "CPU needs recalibration", _
    "system needs to be rebooted", _
    "bit bucket overflow", _
    "descramble code needed from software company", _
    "only available on a need to know basis", _
    "knot in cables caused data stream to become twisted and kinked", _
    "nesting roaches shorted out the ether cable", _
    "The file system is full of it", _
    "Satan did it", _
    "Daemons did it", _
    "You're out of memory", _
    "There isn't any problem", _
    "Unoptimized hard drive", _
    "Typo in the code", _
    "Yes, yes, its called a desgin limitation", _
    "Look, buddy:  Windows 3.1 IS A General Protection Fault.", _
    "That's a great computer you have there; have you considered how it would work as a BSD machine?", _
    "Please excuse me, I have to circuit an AC line through my head to get this database working.", _
    "Yeah, yo mama dresses you funny and you need a mouse to delete files.", _
    "Support staff hung over, send aspirin and come back LATER.", _
    "Someone is standing on the ethernet cable, causeing a kink in the cable", _
    "Windows 95 undocumented " & Chr(34) & "feature" & Chr(34), _
    "Runt packets", _
    "Password is too complex to decrypt", _
    "Boss' kid fucked up the machine", _
    "Electromagnetic energy loss", _
    "Budget cuts", _
    "Mouse chewed through power cable", _
    "Stale file handle (next time use Tupperware(tm)!)", _
    "Feature not yet implimented", _
    "Internet outage", _
    "Pentium FDIV bug", _
    "Vendor no longer supports the product", _
    "Small animal kamikaze attack on power supplies", _
    "The vendor put the bug there.", _
    "SIMM crosstalk.", _
    "IRQ dropout", _
    "Collapsed Backbone", _
    "Power company testing new voltage spike (creation) equipment", _
    "operators on strike due to broken coffee machine", _
    "backup tape overwritten with copy of system manager's favourite CD", _
    "UPS interrupted the server's power", _
    "The electrician didn't know what the yellow cable was so he yanked the ethernet out.", _
    "The keyboard isn't plugged in", _
    "The air conditioning water supply pipe ruptured over the machine room", _
    "The electricity substation in the car park blew up.", _
    "The rolling stones concert down the road caused a brown out", _
    "The salesman drove over the CPU board.", _
    "The monitor is plugged into the serial port", _
    "Root nameservers are out of sync", _
    "electro-magnetic pulses from French above ground nuke testing.", _
    "your keyboard's space bar is generating spurious keycodes.", _
    "the real ttys became pseudo ttys and vice-versa.", _
    "the printer thinks its a router.", _
    "the router thinks its a printer.", _
    "evil hackers from Serbia.", _
    "we just switched to FDDI.", _
    "halon system went off and killed the operators.", _
    "because Bill Gates is a Jehovah's witness and so nothing can work on St. Swithin's day.", _
    "user to computer ratio too high.", _
    "user to computer ration too low.", _
    "we just switched to Sprint.", _
    "it has Intel Inside", _
    "Sticky bits on disk.", _
    "Power Company having EMP problems with their reactor", _
    "The ring needs another token", _
    "new management", _
    "telnet: Unable to connect to remote host: Connection refused", _
    "SCSI Chain overterminated", _
    "It's not plugged in.", _
    "because of network lag due to too many people playing deathmatch", _
    "You put the disk in upside down.", _
    "Daemons loose in system.", _
    "User was distributing pornography on server; system seized by FBI.", _
    "BNC (brain not  (user brain not connected)", _
    "UBNC (user brain not connected)", _
    "LBNC (luser brain not connected)", _
    "disks spinning backwards - toggle the hemisphere jumper.", _
    "new guy cross-connected phone lines with ac power bus.", _
    "had to use hammer to free stuck disk drive heads.", _
    "Too few computrons available.", _
    "Flat tire on station wagon with tapes.  (" & Chr(34) & "Never underestimate the bandwidth of a station wagon full of tapes hurling down the highway" & chr(34) & " - Andrew S. Tanenbaum)", _
    "Communications satellite used by the military for star wars.", _
    "Party-bug in the Aloha protocol.", _
    "Insert coin for new game", _
    "Dew on the telephone lines.", _
    "Arcserve crashed the server again.", _
    "Some one needed the powerstrip, so they pulled the switch plug.", _
    "My pony-tail hit the on/off switch on the power strip.", _
    "Big to little endian conversion error", _
    "You can tune a file system, but you can't tune a fish (from most tunefs man pages)", _
    "Dumb terminal", _
    "Zombie processes haunting the computer", _
    "Incorrect time syncronization", _
    "Defunct processes", _
    "Stubborn processes", _
    "non-redundant fan failure ", _
    "monitor VLF leakage", _
    "bugs in the RAID", _
    "no " & chr(34) & "any" & Chr(34) & " key on keyboard", _
    "root rot", _
    "Backbone Scoliosis", _
    "/pub/lunch", _
    "excessive collisions & not enough packet ambulances", _
    "le0: no carrier: transceiver cable problem?", _
    "broadcast packets on wrong frequency", _
    "popper unable to process jumbo kernel", _
    "NOTICE: alloc: /dev/null: filesystem full", _
    "pseudo-user on a pseudo-terminal", _
    "Recursive traversal of loopback mount points", _
    "Backbone adjustment", _
    "OS swapped to disk", _
    "vapors from evaporating sticky-note adhesives", _
    "sticktion", _
    "short leg on process table", _
    "multicasts on broken packets", _
    "ether leak", _
    "Atilla the Hub", _
    "endothermal recalibration", _
    "filesystem not big enough for Jumbo Kernel Patch", _
    "loop found in loop in redundant loopback", _
    "system consumed all the paper for paging", _
    "permission denied", _
    "Reformatting Page. Wait...", _
    "..disk or the processor is on fire.", _
    "SCSI's too wide.", _
    "Proprietary Information.", _
    "Just type 'mv * /dev/null'.", _
    "runaway cat on system.", _
    "Did you pay the new Support Fee?", _
    "We only support a 1200 bps connection.", _
    "We only support a 28000 bps connection.", _
    "Me no internet, only janitor, me just wax floors.", _
    "I'm sorry a pentium won't do, you need an SGI to connect with us.", _
    "Post-it Note Sludge leaked into the monitor.", _
    "the curls in your keyboard cord are losing electricity.", _
    "The monitor needs another box of pixels.", _
    "RPC_PMAP_FAILURE", _
    "kernel panic: write-only-memory (/dev/wom0) capacity exceeded.", _
    "Write-only-memory subsystem too slow for this machine. Contact your local dealer.", _
    "Just pick up the phone and give modem connect sounds. " & Chr(34) & "Well you said we should get more lines so we don't have voice lines." & Chr(34), _
    "Quantum dynamics are affecting the transistors", _
    "Police are examining all internet packets in the search for a narco-net-traficer", _
    "We are currently trying a new concept of using a live mouse.  Unfortuantely, one has yet to survive being hooked up to the computer.....please bear with us.", _
    "Your mail is being routed through Germany ... and they're censoring us.", _
    "Only people with names beginning with 'A' are getting mail this week (a la Microsoft)", _
    "We didn't pay the Internet bill and it's been cut off.", _
    "Lightning strikes.", _
    "Of course it doesn't work. We've performed a software upgrade.", _
    "Change your language to Finnish.", _
    "Flourescent lights are generating negative ions. If turning them off doesn't work, take them out and put tin foil on the ends.", _
    "High nuclear activity in your area.", _
    "What office are you in? Oh, that one.  Did you know that your building was built over the universities first nuclear research site? And wow, are'nt you the lucky one, your office is right over where the core is buried!", _
    "The MGs ran out of gas.", _
    "The UPS doesn't have a battery backup.", _
    "Recursivity.  Call back if it happens again.", _
    "Someone thought The Big Red Button was a light switch.", _
    "The mainframe needs to rest.  It's getting old, you know.", _
    "I'm not sure.  Try calling the Internet's head office -- it's in the book.", _
    "The lines are all busy (busied out, that is -- why let them in to begin with?).", _
    "Jan  9 16:41:27 huber su: 'su root' succeeded for .... on /dev/pts/1", _
    "It's those computer people in X {city of world}.  They keep stuffing things up.", _
    "A star wars satellite accidently blew up the WAN.", _
    "Fatal error right in front of screen", _
    "That function is not currently supported, but Bill Gates assures us it will be featured in the next upgrade.", _
    "wrong polarity of neutron flow", _
    "Lusers learning curve appears to be fractal", _
    "We had to turn off that service to comply with the CDA Bill.", _
    "Ionisation from the air-conditioning", _
    "TCP/IP UDP alarm threshold is set too low.", _
    "Someone is broadcasting pigmy packets and the router dosn't know how to deal with them.", _
    "The new frame relay network hasn't bedded down the software loop transmitter yet. ", _
    "Fanout dropping voltage too much, try cutting some of those little traces", _
    "Plate voltage too low on demodulator tube", _
    "You did wha... oh _dear_....", _
    "CPU needs bearings repacked", _
    "Too many little pins on CPU confusing it, bend back and forth until 10-20% are neatly removed. Do _not_ leave metal bits visible!", _
    "_Rosin_ core solder? But...", _
    "Software uses US measurements, but the OS is in metric...", _
    "The computer fletely, mouse and all.", _
    "Your cat tried to eat the mouse.", _
    "The Borg tried to assimilate your system. Resistance is futile.", _
    "It must have been the lightning storm we had (yesterdy) (last week) (last month)", _
    "Due to Federal Budget problems we have been forced to cut back on the number of users able to access the system at one time. (namely none allowed....)", _
    "Too much radiation coming from the soil.", _
    "Unfortunately we have run out of bits/bytes/whatever. Don't worry, the next supply will be coming next week.", _
    "Program load too heavy for processor to lift.", _
    "Processes running slowly due to weak power supply", _
    "Our ISP is having {switching,routing,SMDS,frame relay} problems", _
    "We've run out of licenses", _
    "Interference from lunar radiation", _
    "Standing room only on the bus.", _
    "You need to install an RTFM interface.", _
    "That would be because the software doesn't work.", _
    "That's easy to fix, but I can't be bothered.", _
    "Someone's tie is caught in the printer, and if anything else gets printed, he'll be in it too.", _
    "We're upgrading /dev/null", _
    "The Usenet news is out of date", _
    "Our POP server was kidnapped by a weasel.", _
    "It's stuck in the Web.", _
    "Your modem doesn't speak English.", _
    "The mouse escaped.", _
    "All of the packets are empty.", _
    "The UPS is on strike.", _
    "Neutrino overload on the nameserver", _
    "Melting hard drives", _
    "Someone has messed up the kernel pointers", _
    "The kernel license has expired", _
    "Netscape has crashed", _
    "The cord jumped over and hit the power switch.", _
    "It was OK before you touched it.", _
    "Bit rot", _
    "U.S. Postal Service", _
    "Your Flux Capacitor has gone bad.", _
    "The Dilithium Cyrstals need to be rotated.", _
    "The static electricity routing is acting up...", _
    "Traceroute says that there is a routing problem in the backbone.  It's not our problem.", _
    "The co-locator cannot verify the frame-relay gateway to the ISDN server.", _
    "High altitude condensation from U.S.A.F prototype aircraft has contaminated the primary subnet mask. Turn off your computer for 9 days to avoid damaging it.", _
    "Lawn mower blade in your fan need sharpening", _
    "Electrons on a bender", _
    "Telecommunications is upgrading. ", _
    "Telecommunications is downgrading.", _
    "Telecommunications is downshifting.", _
    "Hard drive sleeping. Let it wake up on it's own...", _
    "Interference between the keyboard and the chair.", _
    "The CPU has shifted, and become decentralized.", _
    "Due to the CDA, we no longer have a root account.", _
    "We ran out of dial tone and we're and waiting for the phone company to deliver another bottle.", _
    "You must've hit the wrong anykey.", _
    "PCMCIA slave driver", _
    "The Token fell out of the ring. Call us when you find it.", _
    "The hardware bus needs a new token.", _
    "Too many interrupts", _
    "Not enough interrupts", _
    "The data on your hard drive is out of balance.", _
    "Digital Manipulator exceeding velocity parameters", _
    "appears to be a Slow/Narrow SCSI-0 Interface problem", _
    "microelectronic Riemannian curved-space fault in write-only file system", _
    "fractal radiation jamming the backbone", _
    "routing problems on the neural net", _
    "IRQ-problems with the Un-Interruptable-Power-Supply", _
    "CPU-angle has to be adjusted because of vibrations coming from the nearby road", _
    "emissions from GSM-phones", _
    "CD-ROM server needs recalibration", _
    "firewall needs cooling", _
    "asynchronous inode failure", _
    "transient bus protocol violation", _
    "incompatible bit-registration operators", _
    "your process is not ISO 9000 compliant", _
    "You need to upgrade your VESA local bus to a MasterCard local bus.", _
    "The recent proliferation of Nuclear Testing", _
    "Elves on strike. (Why do they call EMAG Elf Magic)", _
    "Internet exceeded Luser level, please wait until a luser logs off before attempting to log back on.", _
    "Your EMAIL is now being delivered by the USPS.", _
    "Your computer hasn't been returning all the bits it gets from the Internet.", _
    "You've been infected by the Telescoping Hubble virus.", _
    "Scheduled global CPU outage", _
    "Your Pentium has a heating problem - try cooling it with ice cold water.(Do not turn of your computer, you do not want to cool down the Pentium Chip while he isn't working, do you?)", _
    "Your processor has processed too many intructions.  Turn it off emideately, do not type any commands!!", _
    "Your packets were eaten by the terminator", _
    "Your processor does not develop enough heat.", _
    "We need a licensed electrician to replace the light bulbs in the computer room.", _
    "The POP server is out of Coke", _
    "Fiber optics caused gas main leak", _
    "Server depressed, needs Prozak", _
    "quatnum decoherence", _
    "those damn racoons!", _
    "suboptimal routing experience", _
    "A plumber is needed, the network drain is clogged", _
    "50% of the manual is in .pdf readme files", _
    "the AA battery in the wallclock sends magnetic interference", _
    "the xy axis in the trackball is coordinated with the summer soltice", _
    "the butane lighter causes the pincushioning", _
    "old inkjet cartridges emanate barium-based fumes", _
    "manager in the cable duct", _
    "Well fix that in the next (upgrade, update, patch release, service pack).", _
    "HTTPD Error 666 : BOFH was here", _
    "HTTPD Error 4004 : very old Intel cpu - insufficient processing power", _
    "The ATM board has run out of 10 pound notes.  We are having a whip round to refill it, care to contribute ?", _
    "Network failure -  call NBC", _
    "Having to manually track the satellite.", _
    "Your/our computer(s) had suffered a memory leak, and we are waiting for them to be topped up.", _
    "The rubber band broke", _
    "We're on Token Ring, and it looks like the token got loose.", _
    "Stray Alpha Particles from memory packaging caused Hard Memory Error on Server.", _
    "paradigm shift...without a clutch", _
    "PEBKAC (Problem Exists Between Keyboard And Chair)", _
    "The cables are not the same length.", _
    "Second-sytem effect.", _
    "Chewing gum on /dev/sd3c", _
    "Boredom in the Kernel.", _
    "the daemons! the daemons! the terrible daemons!", _
    "I'd love to help you -- it's just that the Boss won't let me near the computer. ", _
    "struck by the Good Times virus", _
    "YOU HAVE AN I/O ERROR -> Incompetent Operator error", _
    "Your parity check is overdrawn and you're out of cache.", _
    "Communist revolutionaries taking over the server room and demanding all the computers in the building or they shoot the sysadmin. Poor misguided fools.", _
    "Plasma conduit breach", _
    "Out of cards on drive D:", _
    "Sand fleas eating the Internet cables", _
    "parallel processors running perpendicular today", _
    "ATM cell has no roaming feature turned on, notebooks can't connect", _
    "Webmasters kidnapped by evil cult.", _
    "Failure to adjust for daylight savings time.", _
    "Virus transmitted from computer to sysadmins.", _
    "Virus due to computers having unsafe sex.", _
    "Incorrectly configured static routes on the corerouters.", _
    "Forced to support NT servers; sysadmins quit.", _
    "Suspicious pointer corrupted virtual machine", _
    "Its the InterNIC's fault.", _
    "Root name servers corrupted.", _
    "Budget cuts forced us to sell all the power cords for the servers.", _
    "Someone hooked the twisted pair wires into the answering machine.", _
    "Operators killed by year 2000 bug bite.", _
    "We've picked COBOL as the language of choice.", _
    "Operators killed when huge stack of backup tapes fell over.", _
    "Robotic tape changer mistook operator's tie for a backup tape.", _
    "Someone was smoking in the computer room and set off the halon systems.", _
    "Your processor has taken a ride to Heaven's Gate on the UFO behind Hale-Bopp's comet.", _
    "t's an ID-10-T error", _
    "Dyslexics retyping hosts file on servers", _
    "The Internet is being scanned for viruses.", _
    "Your computer's union contract is set to expire at midnight.", _
    "Bad user karma.", _
    "/dev/clue was linked to /dev/null", _
    "Increased sunspot activity.", _
    "We already sent around a notice about that.", _
    "It's union rules. There's nothing we can do about it. Sorry.", _
    "Interferance from the Van Allen Belt.", _
    "Jupiter is aligned with Mars.", _
    "Redundant ACLs. ", _
    "Mail server hit by UniSpammer.", _
    "T-1's congested due to porn traffic to the news server.", _
    "Data for intranet got routed through the extranet and landed on the internet.", _
    "We are a 100% Microsoft Shop.", _
    "We are Microsoft.  What you are experiencing is not a problem; it is an undocumented feature.", _
    "Sales staff sold a product we don't offer.", _
    "Secretary sent chain letter to all 5000 employees.", _
    "Sysadmin didn't hear pager go off due to loud music from bar-room speakers.", _
    "Sysadmin accidentally destroyed pager with a large hammer.", _
    "Sysadmins unavailable because they are in a meeting talking about why they are unavailable so much.", _
    "Bad cafeteria food landed all the sysadmins in the hospital.", _
    "Route flapping at the NAP.", _
    "Computers under water due to SYN flooding.", _
    "The vulcan-death-grip ping has been applied.", _
    "Electrical conduits in machine room are melting.", _
    "Traffic jam on the Information Superhighway.", _
    "Radial Telemetry Infiltration", _
    "Cow-tippers tipped a cow onto the server.", _
    "tachyon emissions overloading the system", _
    "Maintence window broken", _
    "We're out of slots on the server", _
    "Computer room being moved.  Our systems are down for the weekend.", _
    "Sysadmins busy fighting SPAM.", _
    "Repeated reboots of the system failed to solve problem", _
    "Feature was not beta tested", _
    "Domain controler not responding", _
    "Someone else stole your IP address, call the Internet detectives!", _
    "It's not RFC-822 compliant.", _
    "operation failed because: there is no message for this error (#1014)", _
    "stop bit received", _
    "internet is needed to catch the etherbunny", _
    "network down, IP packets delivered via UPS", _
    "Firmware update in the coffee machine", _
    "Temporal anomaly", _
    "Mouse has out-of-cheese-error", _
    "Borg implants are failing", _
    "Borg nanites have infested the server", _
    "error: one bad user found in front of screen", _
    "Please state the nature of the technical emergency", _
    "Internet shut down due to maintainance", _
    "Daemon escaped from pentagram", _
    "crop circles in the corn shell", _
    "sticky bit has come loose", _
    "Hot Java has gone cold", _
    "Cache miss - please take better aim next time", _
    "Hash table has woodworm", _
    "Trojan horse ran out of hay", _
    "Zombie processess detected, machine is haunted.", _
    "overflow error in /dev/null", _
    "Browser's cookie is corrupted -- someone's been nibbling on it.", _
    "Mailer-daemon is busy burning your message in hell.", _
    "According to Microsoft, it's by design", _
    "vi needs to be upgraded to vii", _
    "greenpeace free'd the mallocs", _
    "Terorists crashed an airplane into the server room, have to remove /bin/laden. (rm -rf /bin/laden)", _
    "astropneumatic oscillations in the water-cooling", _
    "Somebody ran the operating system through a spelling checker.", _
    "Rhythmic variations in the voltage reaching the power supply.", _
    "Keyboard Actuator Failure.  Order and Replace." _
    )

Function CancelEvent()
    CancelEvent = False
End Function