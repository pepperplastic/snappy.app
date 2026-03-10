import { useState, useEffect, useRef, useMemo, useCallback } from "react";

// ─── STAGES ───
const STAGES = [
  { id: "new", label: "New Lead", color: "#6B7280", icon: "●" },
  { id: "contacted", label: "Contacted", color: "#3B82F6", icon: "📞" },
  { id: "follow_up", label: "Follow Up", color: "#F59E0B", icon: "🔄" },
  { id: "kit_requested", label: "Kit Requested", color: "#8B5CF6", icon: "📦" },
  { id: "outbound_fulfilled", label: "Outbound Fulfilled", color: "#6366F1", icon: "✈️" },
  { id: "package_received", label: "Package Received", color: "#10B981", icon: "📬" },
  { id: "inspected", label: "Inspected", color: "#14B8A6", icon: "🔍" },
  { id: "offer_made", label: "Offer Made", color: "#F97316", icon: "💰" },
  { id: "accepted", label: "Accepted", color: "#22C55E", icon: "✅" },
  { id: "rejected", label: "Rejected", color: "#EF4444", icon: "❌" },
  { id: "purchase_complete", label: "Purchase Complete", color: "#059669", icon: "🎉" },
  { id: "return_complete", label: "Return Complete", color: "#9CA3AF", icon: "↩️" },
  { id: "dead", label: "Dead", color: "#374151", icon: "💀" },
];

const CONTACT_TYPES = ["call", "email", "text", "note"];
const CONTACT_OUTCOMES = {
  call: ["connected", "voicemail", "no_answer", "wrong_number", "callback_scheduled"],
  email: ["sent", "replied", "bounced"],
  text: ["sent", "replied", "no_response"],
  note: ["internal"],
};

// ─── STORAGE KEY ───
const STORAGE_KEY = "snappy_crm_data";
const PIN_KEY = "snappy_crm_auth";
const CORRECT_PIN = "5437"; // Change this

// ─── SEED DATA (225 leads from Google Sheet) ───
const SEED_LEADS = [{"email":"knibbs07@aol.com","name":"","phone":"","item":"14K Yellow Gold Class Ring with Yellow Stone","itemType":"ring","estimate":"$1,400 \u2013 $2,350","shipping":"","address":"","tier":"warm","source":"facebook","timestamp":"2026-02-17T12:18:26","id":"L001","stage":"new","notes":[],"nextFollowUp":null},{"email":"Kim21090@gmail.com","name":"","phone":"","item":"Mixed Silver-Tone Charm Bracelets and Fashion Jewelry Collection","itemType":"bracelet","estimate":"$50 \u2013 $150","shipping":"","address":"","tier":"warm","source":"google","timestamp":"2026-02-17T13:46:12","id":"L002","stage":"new","notes":[],"nextFollowUp":null},{"email":"df20251980@gmail.com","name":"Diana French","phone":"4238986758","item":"Elgin Art Deco Ladies' Watch Gold-Filled","itemType":"watch","estimate":"$150 \u2013 $300","shipping":"kit","address":"","tier":"warm","source":"google","timestamp":"2026-02-17T13:49:03","id":"L003","stage":"new","notes":[],"nextFollowUp":null},{"email":"premieraz@att.net","name":"Howard Gerber","phone":"627432661","item":"14K Yellow Gold Pear Diamond Engagement Ring with Baguette and Round Diamonds","itemType":"ring","estimate":"$12,000 \u2013 $16,000","shipping":"kit","address":"","tier":"warm","source":"facebook","timestamp":"2026-02-17T14:05:31","id":"L004","stage":"new","notes":[],"nextFollowUp":null},{"email":"jrowland328@gmail.com","name":"Jeremy Rowland","phone":"7063717843","item":"Rolex Lady-Datejust Vintage Two-Tone","itemType":"watch","estimate":"$3,500 \u2013 $4,500","shipping":"kit","address":"","tier":"warm","source":"google","timestamp":"2026-02-17T14:34:59","id":"L005","stage":"new","notes":[],"nextFollowUp":null},{"email":"amandafrancis382@gmail.com","name":"Amanda Payne","phone":"","item":"","itemType":"","estimate":"","shipping":"kit","address":"","tier":"cold","source":"google","timestamp":"2026-02-17T17:55:15","id":"L006","stage":"new","notes":[],"nextFollowUp":null},{"email":"Rkurovsky@yahoo.com","name":"","phone":"","item":"Fossil Chronograph Stainless Steel Watch","itemType":"watch","estimate":"$40 \u2013 $80","shipping":"","address":"","tier":"warm","source":"google","timestamp":"2026-02-17T18:23:07","id":"L007","stage":"new","notes":[],"nextFollowUp":null},{"email":"Steelluis1@gmail.com","name":"","phone":"","item":"Chrome Hearts Sterling Silver Cross Pendant Necklace","itemType":"necklace","estimate":"$800 \u2013 $1,200","shipping":"","address":"","tier":"warm","source":"google","timestamp":"2026-02-17T18:28:22","id":"L008","stage":"new","notes":[],"nextFollowUp":null},{"email":"mlwiard5@gmail.com","name":"Michael Wiard","phone":"2317696181","item":"","itemType":"","estimate":"","shipping":"kit","address":"2041 Virginia Drive East, Muskegon, MI, 49444","tier":"cold","source":"google","timestamp":"2026-02-17T19:58:49","id":"L009","stage":"new","notes":[],"nextFollowUp":null},{"email":"nicolenolen74@hotmail.com","name":"","phone":"","item":"14K White Gold Princess Cut Diamond Wedding Ring Set","itemType":"ring","estimate":"$1,200 \u2013 $1,800","shipping":"","address":"","tier":"warm","source":"google","timestamp":"2026-02-17T21:42:40","id":"L010","stage":"new","notes":[],"nextFollowUp":null},{"email":"traceethompson5@gmail.com","name":"Tracee Fout","phone":"2312255704","item":"14K White Gold Diamond Cluster Pendant Necklace","itemType":"necklace","estimate":"$900 \u2013 $1,400","shipping":"kit","address":"","tier":"warm","source":"google","timestamp":"2026-02-18T05:19:34","id":"L011","stage":"new","notes":[],"nextFollowUp":null},{"email":"buckycassell@gmail.com","name":"","phone":"","item":"14K White Gold Diamond Infinity Ring","itemType":"ring","estimate":"$468 \u2013 $750","shipping":"","address":"","tier":"warm","source":"google","timestamp":"2026-02-18T10:08:01","id":"L012","stage":"new","notes":[],"nextFollowUp":null},{"email":"slumpbaby33@gmail.com","name":"Slump Cole","phone":"2544135277","item":"14K Yellow Gold Ring with Diamond Cluster","itemType":"ring","estimate":"$500 \u2013 $950","shipping":"kit","address":"","tier":"warm","source":"google","timestamp":"2026-02-18T12:03:58","id":"L013","stage":"new","notes":[],"nextFollowUp":null},{"email":"winston.elisse2023@gmail.com","name":"Merinda Winston-Hurst","phone":"7253432009","item":"Louis Vuitton Reversible Belt Black/Blue with Silver Hardware","itemType":"belt","estimate":"$350 \u2013 $450","shipping":"kit","address":"","tier":"warm","source":"google","timestamp":"2026-02-18T13:01:52","id":"L014","stage":"new","notes":[],"nextFollowUp":null},{"email":"cal47976@gmail.com","name":"Calvin Bullard","phone":"7867596391","item":"TAG Heuer Formula 1 Chronograph","itemType":"watch","estimate":"$1,100 \u2013 $1,400","shipping":"kit","address":"","tier":"warm","source":"google","timestamp":"2026-02-18T13:21:13","id":"L015","stage":"new","notes":[],"nextFollowUp":null},{"email":"tyliebug99@gmail.com","name":"Christal Davis","phone":"","item":"","itemType":"","estimate":"","shipping":"kit","address":"","tier":"cold","source":"google","timestamp":"2026-02-18T14:46:33","id":"L016","stage":"new","notes":[],"nextFollowUp":null},{"email":"vinusvora@gmail.com","name":"vinas vora","phone":"9379938042","item":"Movado Bold Chronograph with Grey Dial","itemType":"watch","estimate":"$250 \u2013 $400","shipping":"kit","address":"","tier":"warm","source":"google","timestamp":"2026-02-18T14:59:22","id":"L017","stage":"new","notes":[],"nextFollowUp":null},{"email":"jaydenmetzner21@gmail.com","name":"Jayden Metzner","phone":"2514146544","item":"Invicta Reserve Swiss Movement Chronograph Limited Edition","itemType":"watch","estimate":"$150 \u2013 $250","shipping":"kit","address":"","tier":"warm","source":"google","timestamp":"2026-02-18T15:18:58","id":"L018","stage":"new","notes":[],"nextFollowUp":null},{"email":"allblack247@gmail.com","name":"Carlos Moore","phone":"3137276160","item":"","itemType":"","estimate":"","shipping":"kit","address":"","tier":"cold","source":"google","timestamp":"2026-02-18T16:42:27","id":"L019","stage":"new","notes":[],"nextFollowUp":null},{"email":"buenolocs@gmail.com","name":"Daniel Bueno","phone":"4084138874","item":"","itemType":"","estimate":"","shipping":"kit","address":"","tier":"cold","source":"google","timestamp":"2026-02-18T18:41:27","id":"L020","stage":"new","notes":[],"nextFollowUp":null},{"email":"theriverismyplayground@gmail.com","name":"JENNIFER MOORE","phone":"5595441819","item":"","itemType":"","estimate":"","shipping":"kit","address":"","tier":"cold","source":"google","timestamp":"2026-02-18T18:56:49","id":"L021","stage":"new","notes":[],"nextFollowUp":null},{"email":"kgashhal@gmail.com","name":"","phone":"","item":"Fossil Gold-Tone Dress Watch","itemType":"watch","estimate":"$75 \u2013 $125","shipping":"","address":"","tier":"warm","source":"google","timestamp":"2026-02-18T20:56:01","id":"L022","stage":"new","notes":[],"nextFollowUp":null},{"email":"crummartha16@gmail.com","name":"","phone":"","item":"14K Yellow Gold Cuban Link Chain with Diamond Pendant","itemType":"necklace","estimate":"$4,500 \u2013 $7,500","shipping":"","address":"","tier":"warm","source":"google","timestamp":"2026-02-19T07:12:11","id":"L023","stage":"new","notes":[],"nextFollowUp":null},{"email":"mcintirenicole19@gmail.com","name":"Nicole Mcintire","phone":"8145250010","item":"Invicta Timex Interchangeable Watch Set","itemType":"watch","estimate":"$50 \u2013 $150","shipping":"kit","address":"","tier":"warm","source":"google","timestamp":"2026-02-19T12:03:53","id":"L024","stage":"new","notes":[],"nextFollowUp":null},{"email":"mybabywillow24@gmail.com","name":"","phone":"","item":"Louis Vuitton Palm Springs Mini Backpack Monogram Canvas","itemType":"handbag","estimate":"$1,400 \u2013 $1,800","shipping":"","address":"","tier":"warm","source":"google","timestamp":"2026-02-19T13:01:40","id":"L025","stage":"new","notes":[],"nextFollowUp":null},{"email":"lisablazek1071@yahoo.com","name":"Lisa Blazek","phone":"7085959939","item":"14K Yellow Gold Diamond Engagement Ring Set","itemType":"ring","estimate":"$900 \u2013 $1,400","shipping":"kit","address":"","tier":"warm","source":"(direct)","timestamp":"2026-02-19T13:28:38","id":"L026","stage":"new","notes":[],"nextFollowUp":null},{"email":"gobogo7414@gmail.com","name":"Bo Cook","phone":"","item":"14K Yellow Gold ID Bracelet with Diamond Pattern","itemType":"bracelet","estimate":"$1,875 \u2013 $2,812","shipping":"kit","address":"","tier":"warm","source":"facebook","timestamp":"2026-02-19T13:55:19","id":"L027","stage":"new","notes":[],"nextFollowUp":null},{"email":"Dubaibarbie@icloud.com","name":"Luis Angel Cervantes","phone":"","item":"Green Gemstone or Mineral Specimen","itemType":"other","estimate":"","shipping":"kit","address":"","tier":"cold","source":"facebook","timestamp":"2026-02-19T14:15:00","id":"L028","stage":"new","notes":[],"nextFollowUp":null},{"email":"lisap1467@gmail.com","name":"Lisa Paddock","phone":"7163388525","item":"14K Gold Ruby and Diamond Pendant Necklace","itemType":"necklace","estimate":"$750 \u2013 $1,200","shipping":"kit","address":"","tier":"warm","source":"facebook","timestamp":"2026-02-19T14:34:14","id":"L029","stage":"new","notes":[],"nextFollowUp":null},{"email":"Lisap1467@gmail.com","name":"Lisa Paddock","phone":"7163388525","item":"Diamond-Encrusted Butterfly Brooch","itemType":"other","estimate":"$150 \u2013 $400","shipping":"kit","address":"","tier":"warm","source":"facebook","timestamp":"2026-02-19T14:37:53","id":"L030","stage":"new","notes":[],"nextFollowUp":null},{"email":"billydeewilliams15@gmail.com","name":"William Dancy","phone":"4016027106","item":"","itemType":"","estimate":"","shipping":"kit","address":"","tier":"cold","source":"fb","timestamp":"2026-02-19T14:51:14","id":"L031","stage":"new","notes":[],"nextFollowUp":null},{"email":"kllchilders@gmail.com","name":"","phone":"","item":"14K White Gold Diamond Solitaire Engagement Ring","itemType":"ring","estimate":"$600 \u2013 $1,200","shipping":"","address":"","tier":"warm","source":"facebook","timestamp":"2026-02-19T14:58:30","id":"L032","stage":"new","notes":[],"nextFollowUp":null},{"email":"kgashhall@gmail.com","name":"Katelyn Gash-Hall","phone":"6157235274","item":"Fossil Ladies Gold-Tone Dress Watch ES5220","itemType":"watch","estimate":"$75 \u2013 $125","shipping":"kit","address":"","tier":"warm","source":"google","timestamp":"2026-02-19T17:45:04","id":"L033","stage":"new","notes":[],"nextFollowUp":null},{"email":"tfpanthera@gmail.com","name":"Ted Frost","phone":"13104047659","item":"14K White Gold Diamond Cluster Cocktail Rings","itemType":"ring","estimate":"$2,343 \u2013 $3,280","shipping":"kit","address":"","tier":"warm","source":"facebook","timestamp":"2026-02-19T22:00:40","id":"L034","stage":"new","notes":[],"nextFollowUp":null},{"email":"wikiconflict@gmail.com","name":"","phone":"","item":"14K Yellow Gold Star of David Pendant on Box Chain","itemType":"necklace","estimate":"$2,400 \u2013 $3,300","shipping":"","address":"","tier":"warm","source":"(direct)","timestamp":"2026-02-20T04:42:38","id":"L035","stage":"new","notes":[],"nextFollowUp":null},{"email":"cjsmother65@gmail.com","name":"Monica Alder","phone":"","item":"White Gold Solitaire Diamond Engagement Ring","itemType":"ring","estimate":"$800 \u2013 $2,200","shipping":"kit","address":"","tier":"warm","source":"facebook","timestamp":"2026-02-20T08:17:10","id":"L036","stage":"new","notes":[],"nextFollowUp":null},{"email":"bigjoe717@optonline.net","name":"","phone":"","item":"14K Yellow Gold Marquise Diamond Engagement Ring","itemType":"ring","estimate":"$800 \u2013 $1,500","shipping":"","address":"","tier":"warm","source":"google","timestamp":"2026-02-20T08:55:18","id":"L037","stage":"new","notes":[],"nextFollowUp":null},{"email":"jsscalzo@att.net","name":"James Scalzo","phone":"5869790418","item":"18K White Gold Princess Cut Diamond Solitaire Ring","itemType":"ring","estimate":"$2,500 \u2013 $5,500","shipping":"kit","address":"34653 Greentrees , Sterling Heights , Mi, 48312","tier":"hot","source":"(direct)","timestamp":"2026-02-20T09:22:37","id":"L038","stage":"new","notes":[],"nextFollowUp":null},{"email":"mattmccabe187@gmail.com","name":"","phone":"","item":"14K Yellow Gold Praying Hands Pendant Chain by Adrienne Designs","itemType":"necklace","estimate":"$1,950 \u2013 $2,100","shipping":"","address":"","tier":"warm","source":"(direct)","timestamp":"2026-02-20T09:57:26","id":"L039","stage":"new","notes":[],"nextFollowUp":null},{"email":"jbandztribe@icloud.com","name":"Koen Smith","phone":"#ERROR!","item":"18K Yellow Gold Chain","itemType":"necklace","estimate":"$4,220 \u2013 $6,030","shipping":"kit","address":"","tier":"warm","source":"google","timestamp":"2026-02-20T10:51:32","id":"L040","stage":"new","notes":[],"nextFollowUp":null},{"email":"TiarLSmit@gmail.com","name":"Tiara smith","phone":"","item":"Goyard Grenelle Card Holder White","itemType":"wallet","estimate":"$400 \u2013 $550","shipping":"kit","address":"","tier":"warm","source":"google","timestamp":"2026-02-20T11:53:00","id":"L041","stage":"new","notes":[],"nextFollowUp":null},{"email":"offy3415@gmail.com","name":"","phone":"","item":"14K White Gold Diamond Tennis Necklace","itemType":"necklace","estimate":"$3,500 \u2013 $5,500","shipping":"","address":"","tier":"warm","source":"google","timestamp":"2026-02-20T13:09:22","id":"L042","stage":"new","notes":[],"nextFollowUp":null},{"email":"lolitab209@yahoo.com","name":"","phone":"","item":"Cartier Ballon Bleu Automatic","itemType":"watch","estimate":"$4,500 \u2013 $5,500","shipping":"","address":"","tier":"warm","source":"facebook","timestamp":"2026-02-20T13:54:21","id":"L043","stage":"new","notes":[],"nextFollowUp":null},{"email":"lizz_kitkat1988@yahoo.com","name":"","phone":"","item":"14K White Gold Sapphire and Diamond Bypass Ring","itemType":"ring","estimate":"$600 \u2013 $1,100","shipping":"","address":"","tier":"warm","source":"google","timestamp":"2026-02-20T14:54:20","id":"L044","stage":"new","notes":[],"nextFollowUp":null},{"email":"pridepres2008@yahoo.com","name":"Kelly Sullivan","phone":"5408457665","item":"","itemType":"","estimate":"","shipping":"kit","address":"","tier":"cold","source":"facebook","timestamp":"2026-02-20T17:16:49","id":"L045","stage":"new","notes":[],"nextFollowUp":null},{"email":"kellysullivan2008@gmail.com","name":"","phone":"","item":"14K White Gold Three-Stone Ring with Center Emerald Cut Stone","itemType":"ring","estimate":"$550 \u2013 $850","shipping":"","address":"","tier":"warm","source":"(direct)","timestamp":"2026-02-20T17:32:25","id":"L046","stage":"new","notes":[],"nextFollowUp":null},{"email":"hruzicska51@yahoo.com","name":"Heidi Ruzicska","phone":"9893907092","item":"","itemType":"","estimate":"","shipping":"kit","address":"","tier":"cold","source":"facebook","timestamp":"2026-02-20T22:44:31","id":"L047","stage":"new","notes":[],"nextFollowUp":null},{"email":"peytondon826@gmail.com","name":"Daryl Peyton","phone":"8177256644","item":"Women's Rose Gold Tone Chronograph Watch with Mesh Bracelet","itemType":"watch","estimate":"$50 \u2013 $150","shipping":"kit","address":"","tier":"warm","source":"google","timestamp":"2026-02-21T07:55:12","id":"L048","stage":"new","notes":[],"nextFollowUp":null},{"email":"aurora420a@gmail.com","name":"","phone":"","item":"Samsung Galaxy Watch Active2 44mm Black","itemType":"watch","estimate":"$75 \u2013 $125","shipping":"","address":"","tier":"warm","source":"google","timestamp":"2026-02-21T08:04:55","id":"L049","stage":"new","notes":[],"nextFollowUp":null},{"email":"krazy4dolfinzz@gmail.com","name":"Susan Paez","phone":"4235799768","item":"","itemType":"","estimate":"","shipping":"kit","address":"","tier":"cold","source":"google","timestamp":"2026-02-21T08:31:18","id":"L050","stage":"new","notes":[],"nextFollowUp":null},{"email":"hornerkathy20@gmail.com","name":"","phone":"","item":"14K Yellow Gold Nugget-Style Link Bracelet","itemType":"bracelet","estimate":"$2,850 \u2013 $4,250","shipping":"","address":"","tier":"warm","source":"facebook","timestamp":"2026-02-21T09:24:40","id":"L051","stage":"new","notes":[],"nextFollowUp":null},{"email":"henryjosuechavezdias448@gmail.com","name":"Henry Chavez","phone":"9106271463","item":"","itemType":"","estimate":"","shipping":"kit","address":"","tier":"cold","source":"google","timestamp":"2026-02-21T09:28:25","id":"L052","stage":"new","notes":[],"nextFollowUp":null},{"email":"bonitaisthecoolest@yahoo.com","name":"","phone":"","item":"14K Yellow Gold Bangle Bracelet Set","itemType":"bracelet","estimate":"$4,200 \u2013 $5,600","shipping":"","address":"","tier":"warm","source":"facebook","timestamp":"2026-02-21T10:43:35","id":"L053","stage":"new","notes":[],"nextFollowUp":null},{"email":"Bonitaisthecoest@yahoi.com","name":"","phone":"","item":"14K Yellow Gold Band Ring","itemType":"ring","estimate":"$470 \u2013 $940","shipping":"","address":"","tier":"warm","source":"facebook","timestamp":"2026-02-21T10:45:07","id":"L054","stage":"new","notes":[],"nextFollowUp":null},{"email":"tusky04@gmail.com","name":"","phone":"","item":"Bulova Automatic Skeleton Dial Stainless Steel","itemType":"watch","estimate":"$250 \u2013 $350","shipping":"","address":"","tier":"warm","source":"google","timestamp":"2026-02-21T10:57:18","id":"L055","stage":"new","notes":[],"nextFollowUp":null},{"email":"melanieleigh317@gmail.com","name":"","phone":"","item":"Raymond Weil Ladies' Geneve Collection Diamond Gold-Tone","itemType":"watch","estimate":"$200 \u2013 $350","shipping":"","address":"","tier":"warm","source":"google","timestamp":"2026-02-21T11:51:37","id":"L056","stage":"new","notes":[],"nextFollowUp":null},{"email":"btmune88@gmail.com","name":"","phone":"","item":"2.5 Carat Oval Loose Diamond","itemType":"other","estimate":"$2,500 \u2013 $4,000","shipping":"","address":"","tier":"warm","source":"google","timestamp":"2026-02-21T12:03:31","id":"L057","stage":"new","notes":[],"nextFollowUp":null},{"email":"louannescudder6@gmail.com","name":"Louanne Scudder","phone":"","item":"","itemType":"","estimate":"","shipping":"kit","address":"","tier":"cold","source":"facebook","timestamp":"2026-02-21T14:30:28","id":"L058","stage":"new","notes":[],"nextFollowUp":null},{"email":"wyattt11@icloud.com","name":"","phone":"","item":"3.01 Carat Lab Grown Diamond D Color VS2","itemType":"ring","estimate":"$4,500 \u2013 $6,000","shipping":"","address":"","tier":"warm","source":"google","timestamp":"2026-02-21T15:01:24","id":"L059","stage":"new","notes":[],"nextFollowUp":null},{"email":"fowler.myrna@yahoo.com","name":"Myrna Fowler","phone":"3214326114","item":"","itemType":"","estimate":"","shipping":"kit","address":"5544 County Road 1102, Princeton, TX, 75407","tier":"cold","source":"google","timestamp":"2026-02-21T15:33:25","id":"L060","stage":"new","notes":[],"nextFollowUp":null},{"email":"michelleley45@gmail.com","name":"Michelle Padilla","phone":"","item":"14K Yellow Gold Solitaire Diamond Ring","itemType":"ring","estimate":"$260 \u2013 $380","shipping":"kit","address":"","tier":"warm","source":"facebook","timestamp":"2026-02-22T07:18:48","id":"L061","stage":"new","notes":[],"nextFollowUp":null},{"email":"zurovecamanda654@gmail.com","name":"","phone":"","item":"Vintage Gold and Jade Festoon Necklace","itemType":"necklace","estimate":"$2,800 \u2013 $4,500","shipping":"","address":"","tier":"warm","source":"google","timestamp":"2026-02-22T07:19:42","id":"L062","stage":"new","notes":[],"nextFollowUp":null},{"email":"druffner01@gmail.com","name":"","phone":"","item":"14K Yellow Gold Diamond Tennis Bracelet","itemType":"bracelet","estimate":"$1,400 \u2013 $1,800","shipping":"","address":"","tier":"warm","source":"(direct)","timestamp":"2026-02-22T07:57:48","id":"L063","stage":"new","notes":[],"nextFollowUp":null},{"email":"corleyandrew73@gmail.com","name":"","phone":"","item":"Vintage Gold-Toned Bracelet with Green Stones","itemType":"bracelet","estimate":"$150 \u2013 $350","shipping":"","address":"","tier":"warm","source":"google","timestamp":"2026-02-22T09:05:14","id":"L064","stage":"new","notes":[],"nextFollowUp":null},{"email":"rspy79@gmail.com","name":"","phone":"","item":"Citizen Eco-Drive Skyhawk A-T Chronograph","itemType":"watch","estimate":"$250 \u2013 $350","shipping":"","address":"","tier":"warm","source":"google","timestamp":"2026-02-22T09:11:01","id":"L065","stage":"new","notes":[],"nextFollowUp":null},{"email":"twetyan@aol","name":"Anne Groff","phone":"","item":"14K Yellow Gold Diamond Cluster Ring","itemType":"ring","estimate":"$1,200 \u2013 $1,800","shipping":"kit","address":"","tier":"warm","source":"facebook","timestamp":"2026-02-22T09:16:02","id":"L066","stage":"new","notes":[],"nextFollowUp":null},{"email":"samuelfirestine7@gmail.com","name":"Samuel Firestine","phone":"2605573075","item":"Vintage Sterling Silver Bracelet with Opal Cabochons and Pearls","itemType":"bracelet","estimate":"$180 \u2013 $300","shipping":"kit","address":"","tier":"warm","source":"google","timestamp":"2026-02-22T09:32:47","id":"L067","stage":"new","notes":[],"nextFollowUp":null},{"email":"joshdauria@gmail.com","name":"Joshua Dauria","phone":"5015152356","item":"Cartier Pasha de Cartier 1050 Water Resistant","itemType":"watch","estimate":"$3,500 \u2013 $4,500","shipping":"kit","address":"","tier":"warm","source":"google","timestamp":"2026-02-22T10:40:06","id":"L068","stage":"new","notes":[],"nextFollowUp":null},{"email":"freemantony935@gmail.com","name":"Tony Freeman","phone":"3374592169","item":"Vintage Longines Rectangular Manual Wind Watch","itemType":"watch","estimate":"$200 \u2013 $400","shipping":"kit","address":"","tier":"warm","source":"google","timestamp":"2026-02-22T11:05:15","id":"L069","stage":"new","notes":[],"nextFollowUp":null},{"email":"dkeys908@gmail.com","name":"Dustin Keys","phone":"7409354899","item":"14K Yellow Gold Aquamarine and Diamond Cluster Earrings","itemType":"earrings","estimate":"$650 \u2013 $950","shipping":"kit","address":"","tier":"warm","source":"google","timestamp":"2026-02-22T11:19:59","id":"L070","stage":"new","notes":[],"nextFollowUp":null},{"email":"lisahardy847@gmail.com","name":"Lise Hardy","phone":"6812429800","item":"14K Yellow Gold Diamond Wedding Ring Set","itemType":"ring","estimate":"$1,200 \u2013 $1,800","shipping":"kit","address":"","tier":"warm","source":"facebook","timestamp":"2026-02-22T12:20:01","id":"L071","stage":"new","notes":[],"nextFollowUp":null},{"email":"showtime8169@gmail.com","name":"Robert Ortiz","phone":"3365617802","item":"Vintage Lady's Watch with Expansion Bracelet","itemType":"watch","estimate":"$50 \u2013 $150","shipping":"label","address":"657 Decker Rd. , Thomasville, NC, 27360","tier":"hot","source":"google","timestamp":"2026-02-22T12:50:51","id":"L072","stage":"new","notes":[],"nextFollowUp":null},{"email":"kh71691@gmail.com","name":"Karen Habib","phone":"","item":"","itemType":"","estimate":"","shipping":"kit","address":"","tier":"cold","source":"(direct)","timestamp":"2026-02-22T16:57:53","id":"L073","stage":"new","notes":[],"nextFollowUp":null},{"email":"lillybess47@gmail.com","name":"Amber Folk","phone":"5705502716","item":"14K Yellow Gold Rope Chain with Diamond Cross Pendant","itemType":"necklace","estimate":"$2,000 \u2013 $3,200","shipping":"kit","address":"","tier":"warm","source":"facebook","timestamp":"2026-02-22T22:10:34","id":"L074","stage":"new","notes":[],"nextFollowUp":null},{"email":"linsrubies25@yahoo.com","name":"","phone":"","item":"14K Yellow Gold Diamond Wedding Set","itemType":"ring","estimate":"$900 \u2013 $1,500","shipping":"","address":"","tier":"warm","source":"facebook","timestamp":"2026-02-23T08:21:59","id":"L075","stage":"new","notes":[],"nextFollowUp":null},{"email":"lovepizza1983@yahoo.com","name":"David Doro","phone":"4024529744","item":"14K Yellow Gold Emerald and Diamond Halo Earrings","itemType":"earrings","estimate":"$1,200 \u2013 $2,000","shipping":"kit","address":"","tier":"warm","source":"facebook","timestamp":"2026-02-23T09:57:28","id":"L076","stage":"new","notes":[],"nextFollowUp":null},{"email":"britanyoquinn@icloud.com","name":"","phone":"","item":"14K White Gold Vintage Floral Diamond Ring","itemType":"ring","estimate":"$470 \u2013 $750","shipping":"","address":"","tier":"warm","source":"google","timestamp":"2026-02-23T10:23:59","id":"L077","stage":"new","notes":[],"nextFollowUp":null},{"email":"starrking1715@gmail.com","name":"Sean Starr","phone":"5044974067","item":"Bulova Accutron Silver Dial","itemType":"watch","estimate":"$200 \u2013 $400","shipping":"kit","address":"","tier":"warm","source":"facebook","timestamp":"2026-02-23T10:39:42","id":"L078","stage":"new","notes":[],"nextFollowUp":null},{"email":"itstyedoe@icloud.com","name":"","phone":"","item":"Michele MW06A01G5936 Diamond Chronograph","itemType":"watch","estimate":"$300 \u2013 $450","shipping":"","address":"","tier":"warm","source":"google","timestamp":"2026-02-23T11:07:28","id":"L079","stage":"new","notes":[],"nextFollowUp":null},{"email":"durangomexico60@gmail.com","name":"luisa perez","phone":"","item":"14K White Gold Vintage-Style Diamond Engagement Ring","itemType":"ring","estimate":"$600 \u2013 $1,200","shipping":"kit","address":"","tier":"warm","source":"facebook","timestamp":"2026-02-23T11:22:17","id":"L080","stage":"new","notes":[],"nextFollowUp":null},{"email":"cori_61@yahoo.com","name":"Corina Allen","phone":"","item":"","itemType":"","estimate":"","shipping":"kit","address":"","tier":"cold","source":"facebook","timestamp":"2026-02-23T11:23:49","id":"L081","stage":"new","notes":[],"nextFollowUp":null},{"email":"mckennarice777@yahoo.com","name":"McKena Hoffmann","phone":"7405178912","item":"Sterling Silver Charm Bracelet with Multiple Charms","itemType":"bracelet","estimate":"$85 \u2013 $110","shipping":"kit","address":"","tier":"warm","source":"google","timestamp":"2026-02-23T12:35:18","id":"L082","stage":"new","notes":[],"nextFollowUp":null},{"email":"mrodm333@gmail.com","name":"Rodney Moore","phone":"14172270962","item":"14K White Gold Pearl and Diamond Butterfly Ring","itemType":"ring","estimate":"$800 \u2013 $1,500","shipping":"kit","address":"","tier":"warm","source":"facebook","timestamp":"2026-02-24T07:21:55","id":"L083","stage":"new","notes":[],"nextFollowUp":null},{"email":"frenchy5065@gmail.com","name":"","phone":"","item":"14K White Gold Marquise Link Bracelet","itemType":"bracelet","estimate":"$1,900 \u2013 $2,900","shipping":"","address":"","tier":"warm","source":"facebook","timestamp":"2026-02-24T07:46:13","id":"L084","stage":"new","notes":[],"nextFollowUp":null},{"email":"duncandavid1955@gmail.com","name":"","phone":"","item":"Platinum Wedding Band","itemType":"ring","estimate":"$320 \u2013 $480","shipping":"","address":"","tier":"warm","source":"facebook","timestamp":"2026-02-24T08:03:47","id":"L085","stage":"new","notes":[],"nextFollowUp":null},{"email":"crystallalor01@gmail.com","name":"Crystal Lalor","phone":"8645810321","item":"14K White Gold Diamond Band Ring","itemType":"ring","estimate":"$215 \u2013 $280","shipping":"kit","address":"","tier":"warm","source":"facebook","timestamp":"2026-02-24T08:40:46","id":"L086","stage":"new","notes":[],"nextFollowUp":null},{"email":"susanhamilton791@gmail.com","name":"","phone":"","item":"14K Yellow Gold Rope Chain","itemType":"necklace","estimate":"$3,300 \u2013 $4,700","shipping":"","address":"","tier":"warm","source":"facebook","timestamp":"2026-02-25T08:51:14","id":"L087","stage":"new","notes":[],"nextFollowUp":null},{"email":"jennv779@gmail.com","name":"","phone":"","item":"14K Yellow Gold Marquise Diamond Engagement Ring","itemType":"ring","estimate":"$800 \u2013 $1,500","shipping":"","address":"","tier":"warm","source":"facebook","timestamp":"2026-02-25T09:08:14","id":"L088","stage":"new","notes":[],"nextFollowUp":null},{"email":"attnikki@yahoo.com","name":"Ann N Attardo","phone":"6319433472","item":"14K Rose Gold Ring with Red Gemstone","itemType":"ring","estimate":"$750 \u2013 $1,200","shipping":"kit","address":"","tier":"warm","source":"(direct)","timestamp":"2026-02-25T11:38:20","id":"L089","stage":"new","notes":[],"nextFollowUp":null},{"email":"charwestern@msn.com","name":"Charlene Western","phone":"4707676705","item":"14K Yellow Gold Diamond Flower Band Ring","itemType":"ring","estimate":"$1,100 \u2013 $1,600","shipping":"kit","address":"","tier":"warm","source":"facebook","timestamp":"2026-02-25T12:07:30","id":"L090","stage":"new","notes":[],"nextFollowUp":null},{"email":"Crystallalor01@gmail.com","name":"Crystal Lalor","phone":"8645810321","item":"Sterling Silver Diamond Cluster Ring","itemType":"ring","estimate":"$65 \u2013 $120","shipping":"label","address":"119 HOWARD LN APT B, ANDERSON, SC, 29621","tier":"hot","source":"facebook","timestamp":"2026-02-25T20:27:14","id":"L091","stage":"new","notes":[],"nextFollowUp":null},{"email":"evergrnred@yahoo.com","name":"","phone":"","item":"14K Yellow Gold Ring with Black Gemstone","itemType":"ring","estimate":"$469 \u2013 $937","shipping":"","address":"","tier":"warm","source":"facebook","timestamp":"2026-02-26T12:49:36","id":"L092","stage":"new","notes":[],"nextFollowUp":null},{"email":"melodyman1015@aol.com","name":"Robert Boccio","phone":"5168053157","item":"14K Yellow Gold Cuban Link Chain","itemType":"necklace","estimate":"$3,750 \u2013 $5,200","shipping":"kit","address":"","tier":"warm","source":"facebook","timestamp":"2026-02-26T13:29:34","id":"L093","stage":"new","notes":[],"nextFollowUp":null},{"email":"harvestmoon24@msn.com","name":"","phone":"","item":"Neil Lane 14K Gold Lab-Created Diamond Ring","itemType":"ring","estimate":"$550 \u2013 $850","shipping":"","address":"","tier":"warm","source":"facebook","timestamp":"2026-02-26T16:43:14","id":"L094","stage":"new","notes":[],"nextFollowUp":null},{"email":"nativewife2020@yahoo.com","name":"","phone":"","item":"14K White Gold Moonstone Drop Earrings with Diamond Halo","itemType":"earrings","estimate":"$600 \u2013 $900","shipping":"","address":"","tier":"warm","source":"facebook","timestamp":"2026-02-26T21:12:46","id":"L095","stage":"new","notes":[],"nextFollowUp":null},{"email":"rplumlee917@gmail.com","name":"","phone":"","item":"14K Yellow Gold Herringbone Chain Necklace","itemType":"necklace","estimate":"$1,406 \u2013 $2,343","shipping":"","address":"","tier":"warm","source":"facebook","timestamp":"2026-02-27T07:58:24","id":"L096","stage":"new","notes":[],"nextFollowUp":null},{"email":"1993lilmama@gmail.com","name":"","phone":"","item":"14K Yellow Gold Pearl and Diamond Tennis Bracelet","itemType":"bracelet","estimate":"$2,200 \u2013 $3,500","shipping":"","address":"","tier":"warm","source":"facebook","timestamp":"2026-02-27T08:30:54","id":"L097","stage":"new","notes":[],"nextFollowUp":null},{"email":"Thomasenagibbs1@gmail.com","name":"Thomasena gibbs","phone":"8037595189","item":"14K Yellow Gold Diamond Cluster Ring","itemType":"ring","estimate":"$750 \u2013 $1,500","shipping":"kit","address":"","tier":"warm","source":"(direct)","timestamp":"2026-02-27T09:55:15","id":"L098","stage":"new","notes":[],"nextFollowUp":null},{"email":"trosclairrobert@yahoo.com","name":"Robert Trosclair","phone":"3373034592","item":"Antonino Milano Ladies' Watches with Diamond Bezels","itemType":"watch","estimate":"$150 \u2013 $300","shipping":"kit","address":"625 Hamm Street, Franklin, LA, 70538","tier":"hot","source":"google","timestamp":"2026-02-27T13:15:42","id":"L099","stage":"new","notes":[],"nextFollowUp":null},{"email":"bmcardona1983@gmail.com","name":"","phone":"","item":"14K White Gold Pearl Pendant with Diamond Accent","itemType":"necklace","estimate":"$280 \u2013 $467","shipping":"","address":"","tier":"warm","source":"facebook","timestamp":"2026-02-28T07:26:58","id":"L100","stage":"new","notes":[],"nextFollowUp":null},{"email":"susancole47@hotmail.com","name":"","phone":"","item":"14K Yellow Gold Diamond Engagement Ring","itemType":"ring","estimate":"$700 \u2013 $1,200","shipping":"","address":"","tier":"warm","source":"facebook","timestamp":"2026-02-28T08:21:53","id":"L101","stage":"new","notes":[],"nextFollowUp":null},{"email":"selleyjohnathan@gmail.com","name":"","phone":"","item":"14K Yellow Gold Diamond Band Ring","itemType":"ring","estimate":"$500 \u2013 $1,200","shipping":"","address":"","tier":"warm","source":"facebook","timestamp":"2026-02-28T11:13:11","id":"L102","stage":"new","notes":[],"nextFollowUp":null},{"email":"megen827@gmail.com","name":"","phone":"","item":"14K Yellow Gold Ring with Heart Design","itemType":"ring","estimate":"$470 \u2013 $940","shipping":"","address":"","tier":"warm","source":"facebook","timestamp":"2026-02-28T13:15:01","id":"L103","stage":"new","notes":[],"nextFollowUp":null},{"email":"amygomes2@gmail.com","name":"amy gomes","phone":"17044776645","item":"14K Yellow Gold Filigree Diamond Cut Rope Chain Bracelet","itemType":"bracelet","estimate":"$1,400 \u2013 $2,350","shipping":"kit","address":"","tier":"warm","source":"facebook","timestamp":"2026-03-01T07:11:50","id":"L104","stage":"new","notes":[],"nextFollowUp":null},{"email":"terryanglin3699@gmail.com","name":"Terry Anglin","phone":"8598686664","item":"14K White Gold Diamond Halo Engagement Ring Set","itemType":"ring","estimate":"$2,500 \u2013 $4,000","shipping":"kit","address":"","tier":"warm","source":"(direct)","timestamp":"2026-03-01T07:11:51","id":"L105","stage":"new","notes":[],"nextFollowUp":null},{"email":"mward68@gmail.com","name":"","phone":"","item":"Sterling Silver Bear Cuff Bracelet","itemType":"bracelet","estimate":"$150 \u2013 $250","shipping":"","address":"","tier":"warm","source":"facebook","timestamp":"2026-03-01T09:47:38","id":"L106","stage":"new","notes":[],"nextFollowUp":null},{"email":"jdbailey44@gmail.com","name":"Joseph Bailey","phone":"6085096170","item":"","itemType":"","estimate":"","shipping":"kit","address":"","tier":"cold","source":"(direct)","timestamp":"2026-03-01T12:34:58","id":"L107","stage":"new","notes":[],"nextFollowUp":null},{"email":"nikolol2323@gmail.com","name":"","phone":"","item":"14K Gold Plated Solitaire Ring","itemType":"ring","estimate":"$10 \u2013 $25","shipping":"","address":"","tier":"warm","source":"facebook","timestamp":"2026-03-02T07:14:55","id":"L108","stage":"new","notes":[],"nextFollowUp":null},{"email":"kencort36@gmail.com","name":"Eileen Corticchia","phone":"6316824853","item":"14K Yellow Gold Ruby Link Bracelet","itemType":"bracelet","estimate":"$2,200 \u2013 $3,500","shipping":"kit","address":"","tier":"warm","source":"facebook","timestamp":"2026-03-02T11:13:53","id":"L109","stage":"new","notes":[],"nextFollowUp":null},{"email":"reginahanning86@gmail.com","name":"Regina Hanning","phone":"7406831476","item":"18K White Gold Diamond Cluster Engagement Ring","itemType":"ring","estimate":"$2,000 \u2013 $3,500","shipping":"kit","address":"","tier":"warm","source":"facebook","timestamp":"2026-03-02T13:54:37","id":"L110","stage":"new","notes":[],"nextFollowUp":null},{"email":"david@yahoo.com","name":"david weiss","phone":"5617026269","item":"","itemType":"","estimate":"","shipping":"kit","address":"","tier":"cold","source":"(direct)","timestamp":"2026-03-02T14:23:40","id":"L111","stage":"new","notes":[],"nextFollowUp":null},{"email":"ZXZX@sdf.com","name":"ZX ZX","phone":"5617026269","item":"","itemType":"","estimate":"","shipping":"kit","address":"","tier":"cold","source":"(direct)","timestamp":"2026-03-02T14:29:36","id":"L112","stage":"new","notes":[],"nextFollowUp":null},{"email":"weqr@sdf.com","name":"david weiss","phone":"5617026269","item":"","itemType":"","estimate":"","shipping":"kit","address":"","tier":"cold","source":"(direct)","timestamp":"2026-03-02T14:32:46","id":"L113","stage":"new","notes":[],"nextFollowUp":null},{"email":"juliedt1231@gmail.com","name":"Julie Taylor","phone":"","item":"14K White Gold Square Cluster Diamond Ring","itemType":"ring","estimate":"$750 \u2013 $1,125","shipping":"kit","address":"","tier":"warm","source":"facebook","timestamp":"2026-03-03T08:17:27","id":"L114","stage":"new","notes":[],"nextFollowUp":null},{"email":"ehar666.2@gmail.com","name":"Ed Harley","phone":"","item":"14K White Gold Solitaire Diamond Engagement Ring","itemType":"ring","estimate":"$600 \u2013 $1,200","shipping":"kit","address":"","tier":"warm","source":"facebook","timestamp":"2026-03-03T08:39:20","id":"L115","stage":"new","notes":[],"nextFollowUp":null},{"email":"ehar666.1@gmail.com","name":"Ed Harley","phone":"","item":"Stainless Steel Spoon","itemType":"other","estimate":"","shipping":"kit","address":"","tier":"cold","source":"facebook","timestamp":"2026-03-03T08:47:04","id":"L116","stage":"new","notes":[],"nextFollowUp":null},{"email":"ahennecke@yahoo.com","name":"Anthony Hennecke","phone":"","item":"14K Yellow Gold Chain Link Post Earrings","itemType":"earrings","estimate":"$280 \u2013 $470","shipping":"kit","address":"","tier":"warm","source":"facebook","timestamp":"2026-03-03T09:12:37","id":"L117","stage":"new","notes":[],"nextFollowUp":null},{"email":"af@gmial.com","name":"adsf asdf","phone":"","item":"","itemType":"","estimate":"","shipping":"kit","address":"","tier":"cold","source":"","timestamp":"2026-03-03T17:45:36","id":"L118","stage":"new","notes":[],"nextFollowUp":null},{"email":"asdf@gmail.com","name":"david weiss","phone":"","item":"","itemType":"","estimate":"","shipping":"kit","address":"","tier":"cold","source":"","timestamp":"2026-03-03T17:48:40","id":"L119","stage":"new","notes":[],"nextFollowUp":null},{"email":"sadgf@gmIL.COM","name":"david weiss","phone":"","item":"","itemType":"","estimate":"","shipping":"kit","address":"","tier":"cold","source":"","timestamp":"2026-03-03T17:50:34","id":"L120","stage":"new","notes":[],"nextFollowUp":null},{"email":"unfigmint@gmail.com","name":"Davy Brown","phone":"3523884998","item":"14K White Gold Solitaire Diamond Ring Set","itemType":"ring","estimate":"$1,800 \u2013 $2,500","shipping":"kit","address":"","tier":"warm","source":"facebook","timestamp":"2026-03-03T18:05:02","id":"L121","stage":"new","notes":[],"nextFollowUp":null},{"email":"clydecrowley6@gmail.com","name":"","phone":"","item":"14K Yellow Gold Amethyst Heart Ring with Diamond Accents and Matching Pendant","itemType":"ring","estimate":"$750 \u2013 $1,125","shipping":"","address":"","tier":"warm","source":"facebook","timestamp":"2026-03-03T18:52:07","id":"L122","stage":"new","notes":[],"nextFollowUp":null},{"email":"nowlain@hotmail.com","name":"","phone":"","item":"14K Yellow Gold Initial 'S' Ring with Diamond","itemType":"ring","estimate":"$950 \u2013 $1,450","shipping":"","address":"","tier":"warm","source":"facebook","timestamp":"2026-03-03T18:53:57","id":"L123","stage":"new","notes":[],"nextFollowUp":null},{"email":"scottcstuff@hotmail.com","name":"Scott C","phone":"","item":"","itemType":"","estimate":"","shipping":"kit","address":"","tier":"cold","source":"facebook","timestamp":"2026-03-03T20:22:13","id":"L124","stage":"new","notes":[],"nextFollowUp":null},{"email":"Patriciamoseley769@gmail.com","name":"Patricia Moseley","phone":"","item":"14K Gold Heart Pendant with Diamonds","itemType":"jewelry","estimate":"$500 \u2013 $1,200","shipping":"","address":"","tier":"warm","source":"facebook","timestamp":"2026-03-03T21:06:38","id":"L125","stage":"new","notes":[],"nextFollowUp":null},{"email":"patriciamoseley769@gmail.com","name":"Patricia Moseley","phone":"","item":"14K Gold Pearl Ring with Diamond Accents","itemType":"ring","estimate":"$800 \u2013 $1,500","shipping":"","address":"","tier":"warm","source":"facebook","timestamp":"2026-03-03T21:09:30","id":"L126","stage":"new","notes":[],"nextFollowUp":null},{"email":"parnasawholesale@gmail.com","name":"2 2","phone":"","item":"14K Yellow Gold Star of David Pendant Necklace","itemType":"necklace","estimate":"$1,900 \u2013 $2,850","shipping":"","address":"","tier":"warm","source":"","timestamp":"2026-03-03T21:12:31","id":"L127","stage":"new","notes":[],"nextFollowUp":null},{"email":"hello.fafo.health@gmail.com","name":"David Weiss","phone":"","item":"","itemType":"","estimate":"","shipping":"","address":"","tier":"cold","source":"","timestamp":"2026-03-03T21:13:49","id":"L128","stage":"new","notes":[],"nextFollowUp":null},{"email":"patriciamoseley769@gmail","name":"","phone":"","item":"1965 British Shilling Coin","itemType":"coin","estimate":"$1 \u2013 $3","shipping":"","address":"","tier":"warm","source":"facebook","timestamp":"2026-03-03T21:34:57","id":"L129","stage":"new","notes":[],"nextFollowUp":null},{"email":"sockumbeau@yahoo.com","name":"Patricia Moseley","phone":"","item":"","itemType":"","estimate":"","shipping":"","address":"","tier":"cold","source":"facebook","timestamp":"2026-03-03T21:37:43","id":"L130","stage":"new","notes":[],"nextFollowUp":null},{"email":"vb@gmail.com","name":"","phone":"","item":"Rolex Day-Date 40 228238 Green Dial","itemType":"watch","estimate":"$58,000 \u2013 $65,000","shipping":"","address":"","tier":"warm","source":"","timestamp":"2026-03-03T22:06:30","id":"L131","stage":"new","notes":[],"nextFollowUp":null},{"email":"vc@gmail.com","name":"","phone":"","item":"Rolex Day-Date 40 228238 Green Dial","itemType":"watch","estimate":"$52,000 \u2013 $58,000","shipping":"","address":"","tier":"warm","source":"","timestamp":"2026-03-03T22:06:43","id":"L132","stage":"new","notes":[],"nextFollowUp":null},{"email":"tambrahorses@aol.com","name":"Tambra Epps","phone":"3086551904","item":"14K Yellow Gold Diamond Cluster Ring","itemType":"ring","estimate":"$750 \u2013 $1,500","shipping":"","address":"","tier":"warm","source":"facebook","timestamp":"2026-03-03T22:15:51","id":"L133","stage":"new","notes":[],"nextFollowUp":null},{"email":"marvilasoto@yahoo.com","name":"","phone":"","item":"10K Yellow Gold Bow Ring with Diamond Accent","itemType":"ring","estimate":"$335 \u2013 $550","shipping":"","address":"","tier":"warm","source":"facebook","timestamp":"2026-03-04T00:20:51","id":"L134","stage":"new","notes":[],"nextFollowUp":null},{"email":"pdreyna86@gmail.com","name":"","phone":"","item":"14K White Gold Solitaire Diamond Engagement Ring","itemType":"ring","estimate":"$2,500 \u2013 $4,500","shipping":"","address":"","tier":"warm","source":"facebook","timestamp":"2026-03-04T01:18:07","id":"L135","stage":"new","notes":[],"nextFollowUp":null},{"email":"homeisthelou@gmail.com","name":"","phone":"","item":"14K Yellow Gold Diamond Band Ring","itemType":"ring","estimate":"$700 \u2013 $1,200","shipping":"","address":"","tier":"warm","source":"facebook","timestamp":"2026-03-04T02:03:31","id":"L136","stage":"new","notes":[],"nextFollowUp":null},{"email":"lhamondanny5@gmail.com","name":"Danny Lhamon","phone":"740-979-7428","item":"14K White Gold Solitaire Diamond Engagement Ring","itemType":"ring","estimate":"$2,800 \u2013 $4,200","shipping":"","address":"","tier":"warm","source":"facebook","timestamp":"2026-03-04T08:11:24","id":"L137","stage":"new","notes":[],"nextFollowUp":null},{"email":"whiteallenshirley@gmail.com","name":"","phone":"","item":"14K Yellow Gold Wire-Wrapped Bracelet with White Stone","itemType":"bracelet","estimate":"$1,405 \u2013 $2,343","shipping":"","address":"","tier":"warm","source":"facebook","timestamp":"2026-03-04T11:02:31","id":"L138","stage":"new","notes":[],"nextFollowUp":null},{"email":"Johnowens6683@gmail.com","name":"John Owens","phone":"","item":"14K White Gold Three-Stone Diamond Engagement Ring","itemType":"ring","estimate":"$1,800 \u2013 $3,500","shipping":"","address":"","tier":"warm","source":"facebook","timestamp":"2026-03-04T11:12:35","id":"L139","stage":"new","notes":[],"nextFollowUp":null},{"email":"scanlady2018@gmail.com","name":"Jo Bell","phone":"","item":"14K Yellow Gold Diamond Articulated Lizard/Crocodile Bracelet","itemType":"bracelet","estimate":"$7,500 \u2013 $10,000","shipping":"","address":"","tier":"warm","source":"facebook","timestamp":"2026-03-04T11:23:33","id":"L140","stage":"new","notes":[],"nextFollowUp":null},{"email":"gloverd531@gmail.com","name":"Denver Glover","phone":"8284053740","item":"","itemType":"","estimate":"","shipping":"","address":"","tier":"cold","source":"facebook","timestamp":"2026-03-04T12:50:25","id":"L141","stage":"new","notes":[],"nextFollowUp":null},{"email":"Gloverd531@gmail.com","name":"Denver Glover","phone":"8284053740","item":"","itemType":"","estimate":"","shipping":"","address":"","tier":"cold","source":"facebook","timestamp":"2026-03-04T12:57:11","id":"L142","stage":"new","notes":[],"nextFollowUp":null},{"email":"paobarzelatto@gmail.com","name":"Paola Barzelatto","phone":"7868162828","item":"14K White Gold Diamond Band Ring","itemType":"ring","estimate":"$1,200 \u2013 $1,800","shipping":"","address":"","tier":"warm","source":"facebook","timestamp":"2026-03-04T13:00:07","id":"L143","stage":"new","notes":[],"nextFollowUp":null},{"email":"portugalpride@yahoo.com","name":"Susan Bettencourt","phone":"9787267533","item":"","itemType":"","estimate":"","shipping":"","address":"","tier":"cold","source":"facebook","timestamp":"2026-03-04T14:01:53","id":"L144","stage":"new","notes":[],"nextFollowUp":null},{"email":"missfargo00@hotmail.com","name":"Jill Borgerding","phone":"7017996463","item":"Platinum or White Gold Diamond Stud Earrings","itemType":"earrings","estimate":"$4,500 \u2013 $8,000","shipping":"","address":"","tier":"warm","source":"","timestamp":"2026-03-04T15:27:44","id":"L145","stage":"new","notes":[],"nextFollowUp":null},{"email":"j.sherry6803@gmail.com","name":"","phone":"","item":"14K White Gold Aquamarine and Diamond Ring","itemType":"ring","estimate":"$600 \u2013 $1,100","shipping":"","address":"","tier":"warm","source":"facebook","timestamp":"2026-03-04T15:46:52","id":"L146","stage":"new","notes":[],"nextFollowUp":null},{"email":"pamjkuhn@gmail.com","name":"Pamela Kuhn","phone":"","item":"18K Yellow Gold Cocktail Ring with Purple Sapphire and Diamonds","itemType":"ring","estimate":"$2,800 \u2013 $4,500","shipping":"","address":"","tier":"warm","source":"facebook","timestamp":"2026-03-04T15:48:56","id":"L147","stage":"new","notes":[],"nextFollowUp":null},{"email":"j.sherry80@yahoo.com","name":"Sherry Jones","phone":"","item":"","itemType":"","estimate":"","shipping":"","address":"","tier":"cold","source":"facebook","timestamp":"2026-03-04T15:55:48","id":"L148","stage":"new","notes":[],"nextFollowUp":null},{"email":"briankgil57@gmail.com","name":"","phone":"","item":"Omega Seamaster Professional 300m Blue Wave Dial","itemType":"watch","estimate":"$2,200 \u2013 $2,800","shipping":"","address":"","tier":"warm","source":"facebook","timestamp":"2026-03-04T16:38:36","id":"L149","stage":"new","notes":[],"nextFollowUp":null},{"email":"bootsandcheebs@gmail.com","name":"","phone":"","item":"14K Yellow Gold Solitaire Diamond Engagement Ring","itemType":"ring","estimate":"$8,500 \u2013 $15,000","shipping":"","address":"","tier":"warm","source":"facebook","timestamp":"2026-03-04T16:51:27","id":"L150","stage":"new","notes":[],"nextFollowUp":null},{"email":"anaphebbe@gmail.com","name":"","phone":"","item":"14K Yellow Gold Diamond Signet Ring","itemType":"ring","estimate":"$1450 \u2013 $2000","shipping":"","address":"","tier":"warm","source":"facebook","timestamp":"2026-03-04T18:32:40","id":"L151","stage":"new","notes":[],"nextFollowUp":null},{"email":"Reneepolk983@gmail.com","name":"Myrle Polk","phone":"2544930775","item":"14K Gold Diamond Ring","itemType":"ring","estimate":"$750 \u2013 $1,125","shipping":"","address":"","tier":"warm","source":"facebook","timestamp":"2026-03-04T19:04:05","id":"L152","stage":"new","notes":[],"nextFollowUp":null},{"email":"reneepolk983@gmail.com","name":"Myrle Polk","phone":"2544930775","item":"","itemType":"","estimate":"","shipping":"","address":"","tier":"cold","source":"facebook","timestamp":"2026-03-04T19:21:19","id":"L153","stage":"new","notes":[],"nextFollowUp":null},{"email":"sheltonchrisandra@gmail.com","name":"Chrisandra Shelton","phone":"2602340196","item":"14K Two-Tone Gold Diamond Solitaire Engagement Ring","itemType":"ring","estimate":"$650 \u2013 $1,100","shipping":"","address":"","tier":"warm","source":"facebook","timestamp":"2026-03-04T20:15:19","id":"L154","stage":"new","notes":[],"nextFollowUp":null},{"email":"jodicottle516@gmail.com","name":"","phone":"","item":"14K White Gold Diamond Engagement Ring Set","itemType":"ring","estimate":"$1,500 \u2013 $2,200","shipping":"","address":"","tier":"warm","source":"facebook","timestamp":"2026-03-04T20:33:48","id":"L155","stage":"new","notes":[],"nextFollowUp":null},{"email":"webe4x4@hotmail.com","name":"Wes Bellows","phone":"","item":"14K Gold Diamond Band Ring","itemType":"ring","estimate":"$469 \u2013 $937","shipping":"","address":"","tier":"warm","source":"facebook","timestamp":"2026-03-04T21:20:12","id":"L156","stage":"new","notes":[],"nextFollowUp":null},{"email":"russellsylestine8@gmail.com","name":"","phone":"","item":"14K Yellow Gold Cuban Link Bracelet","itemType":"bracelet","estimate":"$2,811 \u2013 $4,218","shipping":"","address":"","tier":"warm","source":"","timestamp":"2026-03-05T00:01:25","id":"L157","stage":"new","notes":[],"nextFollowUp":null},{"email":"kyah0115@gmail.com","name":"","phone":"","item":"14K Yellow Gold Locket Necklace with Green Gemstone","itemType":"necklace","estimate":"$1,405 \u2013 $2,343","shipping":"","address":"","tier":"warm","source":"facebook","timestamp":"2026-03-05T00:24:41","id":"L158","stage":"new","notes":[],"nextFollowUp":null},{"email":"susan.brzozowski@yahoo.com","name":"","phone":"","item":"14K White Gold or Platinum Diamond Engagement Ring with GIA Certification","itemType":"ring","estimate":"$8,500 \u2013 $15,000","shipping":"","address":"","tier":"warm","source":"facebook","timestamp":"2026-03-05T02:15:19","id":"L159","stage":"new","notes":[],"nextFollowUp":null},{"email":"pquickley64@gmail.com","name":"","phone":"","item":"14K Yellow Gold Solitaire Diamond Ring","itemType":"ring","estimate":"$600 \u2013 $1,500","shipping":"","address":"","tier":"warm","source":"facebook","timestamp":"2026-03-05T03:35:02","id":"L160","stage":"new","notes":[],"nextFollowUp":null},{"email":"pamela.quickley64@icloud.com","name":"","phone":"","item":"14K White Gold Diamond Solitaire Pendant","itemType":"ring","estimate":"$350 \u2013 $600","shipping":"","address":"","tier":"warm","source":"facebook","timestamp":"2026-03-05T03:49:16","id":"L161","stage":"new","notes":[],"nextFollowUp":null},{"email":"chadmadden1975@gmail.com","name":"Chad madden","phone":"","item":"","itemType":"","estimate":"","shipping":"","address":"","tier":"cold","source":"facebook","timestamp":"2026-03-05T05:38:11","id":"L162","stage":"new","notes":[],"nextFollowUp":null},{"email":"jamesjaschob@yahoo.com","name":"James Jaschob","phone":"9204182186","item":"14K White and Yellow Gold Diamond Ring 1.60ct","itemType":"ring","estimate":"$4,500 \u2013 $6,000","shipping":"","address":"","tier":"warm","source":"facebook","timestamp":"2026-03-05T08:51:26","id":"L163","stage":"new","notes":[],"nextFollowUp":null},{"email":"rlindner12702@yahoo.com","name":"Regine Lindner","phone":"7134478195","item":"14K Yellow Gold Diamond Tennis Bracelet - 1 Carat TW","itemType":"bracelet","estimate":"$2,200 \u2013 $3,500","shipping":"","address":"","tier":"warm","source":"facebook","timestamp":"2026-03-05T08:51:42","id":"L164","stage":"new","notes":[],"nextFollowUp":null},{"email":"jeannette032721@gmail.com","name":"James Jaschob","phone":"9204182186","item":"14K White and Yellow Gold Diamond Ring - 1.60ct","itemType":"ring","estimate":"$3,500 \u2013 $4,800","shipping":"","address":"","tier":"warm","source":"facebook","timestamp":"2026-03-05T09:02:48","id":"L165","stage":"new","notes":[],"nextFollowUp":null},{"email":"beautifulava0807@gmail.com","name":"Carrie Shropshire","phone":"5312106272","item":"Bulova Vintage Automatic Day-Date 23 Jewels","itemType":"watch","estimate":"$150 \u2013 $250","shipping":"","address":"","tier":"warm","source":"google%26utm_medium=cpc%26utm_campaign=snappy_gold_v1%26utm_content=194908851722%26gad_source=1%26gad_campaignid=23570864123%26gclid=Cj0KCQiA7-rMBhCFARIsAKnLKtBdZX0FKFvgqO1vq8zS-23pYqojbBSl3Q9fHfeFQDXUVDTUlEzMZBEaAuq5EALw_wcB","timestamp":"2026-03-05T09:27:14","id":"L166","stage":"new","notes":[],"nextFollowUp":null},{"email":"jenjohnny2011@yahoo.com","name":"Jennifer Countryman","phone":"","item":"18K Yellow Gold Signet Rings with Coin Design","itemType":"ring","estimate":"$3,617 \u2013 $6,029","shipping":"","address":"","tier":"warm","source":"facebook","timestamp":"2026-03-05T11:07:34","id":"L167","stage":"new","notes":[],"nextFollowUp":null},{"email":"susannrun@aol.com","name":"","phone":"","item":"14K Yellow Gold Mystic Topaz Ring with Diamond Accents","itemType":"ring","estimate":"$950 \u2013 $1,450","shipping":"","address":"","tier":"warm","source":"facebook","timestamp":"2026-03-05T12:43:11","id":"L168","stage":"new","notes":[],"nextFollowUp":null},{"email":"lafollettekeith@gmail.com","name":"Keith Lafollette","phone":"7407052258","item":"14K Rose Gold Pear-Cut Sapphire Ring with Diamond Halo","itemType":"ring","estimate":"$800 \u2013 $1,500","shipping":"","address":"","tier":"warm","source":"fb","timestamp":"2026-03-05T12:51:52","id":"L169","stage":"new","notes":[],"nextFollowUp":null},{"email":"conniecgriesser@gmail.com","name":"","phone":"","item":"14K White Gold Diamond Flower Cocktail Ring","itemType":"ring","estimate":"$950 \u2013 $1,900","shipping":"","address":"","tier":"warm","source":"facebook","timestamp":"2026-03-05T13:06:12","id":"L170","stage":"new","notes":[],"nextFollowUp":null},{"email":"alohabarbour07@gmail.com","name":"Cleo Scott","phone":"","item":"14K White Gold Diamond Wedding Ring Set","itemType":"ring","estimate":"$1,200 \u2013 $1,800","shipping":"","address":"","tier":"warm","source":"","timestamp":"2026-03-05T13:59:06","id":"L171","stage":"new","notes":[],"nextFollowUp":null},{"email":"leebenr@gmail.com","name":"Ben Lee","phone":"5859433543","item":"10K Yellow Gold Class/Fraternal Ring with Red Stone","itemType":"ring","estimate":"$1,340 \u2013 $1,500","shipping":"","address":"","tier":"warm","source":"facebook","timestamp":"2026-03-05T16:28:18","id":"L172","stage":"new","notes":[],"nextFollowUp":null},{"email":"ericvega1337@gmail.com","name":"","phone":"","item":"14K White Gold Diamond Engagement Ring","itemType":"ring","estimate":"$1,200 \u2013 $2,500","shipping":"","address":"","tier":"warm","source":"facebook","timestamp":"2026-03-05T16:30:20","id":"L173","stage":"new","notes":[],"nextFollowUp":null},{"email":"anhtran232776@gmail.com","name":"","phone":"","item":"14K Yellow Gold Thin Band Ring","itemType":"ring","estimate":"$280 \u2013 $470","shipping":"","address":"","tier":"warm","source":"facebook","timestamp":"2026-03-05T17:13:57","id":"L174","stage":"new","notes":[],"nextFollowUp":null},{"email":"rwnakdimon@gmail.com","name":"","phone":"","item":"Van Cleef & Arpels 14K White Gold Diamond Tennis Bracelet with Alhambra Charm","itemType":"bracelet","estimate":"$8,500 \u2013 $12,000","shipping":"","address":"","tier":"warm","source":"","timestamp":"2026-03-05T17:44:40","id":"L175","stage":"new","notes":[],"nextFollowUp":null},{"email":"arismile513@gmail.com","name":"","phone":"","item":"Invicta Speedway 4223 Two-Tone Chronograph","itemType":"watch","estimate":"$150 \u2013 $250","shipping":"","address":"","tier":"warm","source":"facebook","timestamp":"2026-03-05T19:01:35","id":"L176","stage":"new","notes":[],"nextFollowUp":null},{"email":"spmommy050811@yahoo.com","name":"","phone":"","item":"14K Yellow Gold Masonic Ring","itemType":"ring","estimate":"$950 \u2013 $1,450","shipping":"","address":"","tier":"warm","source":"","timestamp":"2026-03-05T21:22:05","id":"L177","stage":"new","notes":[],"nextFollowUp":null},{"email":"frankcastellano97@hotmail.com","name":"","phone":"","item":"14K Yellow Gold Cuban Link Chain","itemType":"necklace","estimate":"$3,300 \u2013 $4,700","shipping":"","address":"","tier":"warm","source":"facebook","timestamp":"2026-03-05T21:25:31","id":"L178","stage":"new","notes":[],"nextFollowUp":null},{"email":"suruuuhnkodak@gmail.com","name":"Sarah Graham","phone":"8593053202","item":"","itemType":"","estimate":"","shipping":"","address":"","tier":"cold","source":"","timestamp":"2026-03-06T01:03:07","id":"L179","stage":"new","notes":[],"nextFollowUp":null},{"email":"stillscynthia6@gmail.com","name":"Cynthia Stills","phone":"5599624627","item":"14K Yellow Gold Armenian Cross Signet Ring","itemType":"ring","estimate":"$1,900 \u2013 $2,850","shipping":"","address":"","tier":"warm","source":"facebook","timestamp":"2026-03-06T05:07:00","id":"L180","stage":"new","notes":[],"nextFollowUp":null},{"email":"jjccoconougher@gmail.com","name":"","phone":"","item":"Platinum Diamond Engagement Ring with Baguette Side Stones","itemType":"ring","estimate":"$1,200 \u2013 $2,000","shipping":"","address":"","tier":"warm","source":"facebook","timestamp":"2026-03-06T05:13:52","id":"L181","stage":"new","notes":[],"nextFollowUp":null},{"email":"nikkolighting50@gmail.com","name":"","phone":"","item":"Platinum Diamond Engagement Ring with Baguette Accents","itemType":"ring","estimate":"$1,800 \u2013 $3,200","shipping":"","address":"","tier":"warm","source":"facebook","timestamp":"2026-03-06T05:15:42","id":"L182","stage":"new","notes":[],"nextFollowUp":null},{"email":"angelcragg@gmail.com","name":"Angel Mobley","phone":"","item":"","itemType":"","estimate":"","shipping":"","address":"","tier":"cold","source":"facebook","timestamp":"2026-03-06T11:15:01","id":"L183","stage":"new","notes":[],"nextFollowUp":null},{"email":"dedrelewis9@gmail.com","name":"","phone":"","item":"14K White Gold Diamond Engagement Ring","itemType":"ring","estimate":"$1,200 \u2013 $2,500","shipping":"","address":"","tier":"warm","source":"facebook","timestamp":"2026-03-06T12:25:24","id":"L184","stage":"new","notes":[],"nextFollowUp":null},{"email":"scsnlady2018@gmail.com","name":"","phone":"","item":"14K Gold Dome Ring with Pearl and Diamond Accents","itemType":"ring","estimate":"$950 \u2013 $1,900","shipping":"","address":"","tier":"warm","source":"facebook","timestamp":"2026-03-06T12:52:33","id":"L185","stage":"new","notes":[],"nextFollowUp":null},{"email":"wgadkins_99@yahoo.com","name":"William Adkins","phone":"4084178850","item":"","itemType":"","estimate":"","shipping":"","address":"","tier":"cold","source":"facebook","timestamp":"2026-03-06T13:14:12","id":"L186","stage":"new","notes":[],"nextFollowUp":null},{"email":"jharbison@gmail.com","name":"Jimmy Harbison","phone":"","item":"14K Yellow Gold Ring with Diamonds","itemType":"ring","estimate":"$470 \u2013 $940","shipping":"","address":"","tier":"warm","source":"facebook","timestamp":"2026-03-06T15:24:17","id":"L187","stage":"new","notes":[],"nextFollowUp":null},{"email":"goddesssha@me.com","name":"","phone":"","item":"14K Gold Diamond Stud Earrings 1.57 CTW","itemType":"earrings","estimate":"$2,800 \u2013 $3,500","shipping":"","address":"","tier":"warm","source":"facebook","timestamp":"2026-03-06T18:31:10","id":"L188","stage":"new","notes":[],"nextFollowUp":null},{"email":"m.ryland@comcast.net","name":"Michael Ryland","phone":"4438073966","item":"14K White Gold Diamond Cluster Ring","itemType":"ring","estimate":"$700 \u2013 $1,400","shipping":"","address":"","tier":"warm","source":"facebook","timestamp":"2026-03-06T19:28:36","id":"L189","stage":"new","notes":[],"nextFollowUp":null},{"email":"tricindy13@gmail.com","name":"","phone":"","item":"14K Yellow Gold and Platinum Tacori Diamond Band","itemType":"ring","estimate":"$1,200 \u2013 $1,800","shipping":"","address":"","tier":"warm","source":"facebook","timestamp":"2026-03-06T21:09:16","id":"L190","stage":"new","notes":[],"nextFollowUp":null},{"email":"alaska_grl69@hotmail.com","name":"","phone":"","item":"14K Yellow Gold Diamond Cluster Ring","itemType":"ring","estimate":"$500 \u2013 $850","shipping":"","address":"","tier":"warm","source":"facebook","timestamp":"2026-03-06T23:57:49","id":"L191","stage":"new","notes":[],"nextFollowUp":null},{"email":"julius.tobar@icloud.com","name":"","phone":"","item":"Michael Kors Gold-Tone Watch with Green Dial","itemType":"watch","estimate":"$75 \u2013 $125","shipping":"","address":"","tier":"warm","source":"","timestamp":"2026-03-07T03:46:24","id":"L192","stage":"new","notes":[],"nextFollowUp":null},{"email":"rigoh2873@gmail.com","name":"Rigo Hernandez","phone":"5037706932","item":"14K White Gold Princess Cut Diamond Engagement Ring","itemType":"ring","estimate":"$1,200 \u2013 $2,200","shipping":"","address":"","tier":"warm","source":"","timestamp":"2026-03-07T04:07:57","id":"L193","stage":"new","notes":[],"nextFollowUp":null},{"email":"jewel200517@gmail.com","name":"Julie Salmon","phone":"6084120487","item":"14K White Gold Multi-Band Diamond Ring","itemType":"ring","estimate":"$800 \u2013 $1,400","shipping":"","address":"","tier":"warm","source":"facebook","timestamp":"2026-03-07T09:32:07","id":"L194","stage":"new","notes":[],"nextFollowUp":null},{"email":"burchfieldsheila@yahoo.com","name":"Sheila Burchfield","phone":"","item":"14K Yellow Gold Diamond-Cut Pattern Ring","itemType":"ring","estimate":"$750 \u2013 $1,125","shipping":"","address":"","tier":"warm","source":"facebook","timestamp":"2026-03-07T11:20:40","id":"L195","stage":"new","notes":[],"nextFollowUp":null},{"email":"aldubimanal09@gmail.com","name":"","phone":"","item":"10K Gold Diamond Cluster Ring","itemType":"ring","estimate":"$450 \u2013 $750","shipping":"","address":"","tier":"warm","source":"facebook","timestamp":"2026-03-07T15:02:50","id":"L196","stage":"new","notes":[],"nextFollowUp":null},{"email":"kschwab89@hotmail.com","name":"Kathy Schwab","phone":"","item":"14K Yellow Gold Diamond Engagement Ring","itemType":"ring","estimate":"$469 \u2013 $1,100","shipping":"","address":"","tier":"warm","source":"","timestamp":"2026-03-07T15:26:56","id":"L197","stage":"new","notes":[],"nextFollowUp":null},{"email":"nicolesobell@gmail.com","name":"Nicole Sobell","phone":"2692678011","item":"14K Yellow Gold Engraved Band Ring","itemType":"ring","estimate":"$470 \u2013 $940","shipping":"","address":"","tier":"warm","source":"facebook","timestamp":"2026-03-07T16:28:23","id":"L198","stage":"new","notes":[],"nextFollowUp":null},{"email":"kawboy11969@gmail.com","name":"","phone":"","item":"Wittnauer QWR Day-Date Two-Tone","itemType":"watch","estimate":"$150 \u2013 $300","shipping":"","address":"","tier":"warm","source":"","timestamp":"2026-03-07T18:46:28","id":"L199","stage":"new","notes":[],"nextFollowUp":null},{"email":"timf_2000@outlook.com","name":"","phone":"","item":"14K Yellow Gold Figaro Link Chain","itemType":"necklace","estimate":"$3,300 \u2013 $4,700","shipping":"","address":"","tier":"warm","source":"","timestamp":"2026-03-07T21:35:01","id":"L200","stage":"new","notes":[],"nextFollowUp":null},{"email":"charlietmn@gmail.com","name":"Tri Nguyen","phone":"","item":"14K White Gold Figaro Link Chain","itemType":"necklace","estimate":"$1,875 \u2013 $2,812","shipping":"","address":"","tier":"warm","source":"","timestamp":"2026-03-07T21:59:43","id":"L201","stage":"new","notes":[],"nextFollowUp":null},{"email":"Charlietmn@gmail.com","name":"Tri Nguyen","phone":"","item":"Sterling Silver Bamboo Link Bracelet","itemType":"bracelet","estimate":"$40 \u2013 $65","shipping":"","address":"","tier":"warm","source":"facebook","timestamp":"2026-03-07T22:10:07","id":"L202","stage":"new","notes":[],"nextFollowUp":null},{"email":"staszakkellene945@gmail.com","name":"","phone":"","item":"14K White Gold Solitaire Ring with Clear Gemstone","itemType":"ring","estimate":"$335 \u2013 $935","shipping":"","address":"","tier":"warm","source":"","timestamp":"2026-03-08T00:01:46","id":"L203","stage":"new","notes":[],"nextFollowUp":null},{"email":"mclancy1973@gmail.com","name":"","phone":"","item":"10K Yellow Gold Ruby and Diamond Cluster Ring","itemType":"ring","estimate":"$450 \u2013 $850","shipping":"","address":"","tier":"warm","source":"facebook","timestamp":"2026-03-08T01:02:38","id":"L204","stage":"new","notes":[],"nextFollowUp":null},{"email":"mzstaceysmith22@gmail.com","name":"Stacey Ledbetter","phone":"","item":"14K Yellow Gold Pendant Necklace with Diamond","itemType":"necklace","estimate":"$750 \u2013 $1,125","shipping":"","address":"","tier":"warm","source":"fb","timestamp":"2026-03-08T01:22:55","id":"L205","stage":"new","notes":[],"nextFollowUp":null},{"email":"zacjay0137@gmail.com","name":"","phone":"","item":"Sterling Silver Cross Pendant with Rhinestones on Chain","itemType":"necklace","estimate":"$36 \u2013 $60","shipping":"","address":"","tier":"warm","source":"facebook","timestamp":"2026-03-08T03:21:16","id":"L206","stage":"new","notes":[],"nextFollowUp":null},{"email":"tinaabaker71@yahoo.com","name":"Tina Baker","phone":"3368290628","item":"14K White Gold Diamond Halo Engagement Ring Set","itemType":"ring","estimate":"$1,200 \u2013 $1,800","shipping":"","address":"","tier":"warm","source":"facebook","timestamp":"2026-03-08T06:04:56","id":"L207","stage":"new","notes":[],"nextFollowUp":null},{"email":"shawndwhite64@gmail.com","name":"Shawn Morton","phone":"","item":"14K Gold Diamond Engagement Ring Set with Baguette Accents","itemType":"ring","estimate":"$1,600 \u2013 $2,400","shipping":"","address":"","tier":"warm","source":"fb","timestamp":"2026-03-08T12:15:51","id":"L208","stage":"new","notes":[],"nextFollowUp":null},{"email":"a.s@du.htnet.hr","name":"ANTONIO SEGEDIN","phone":"00385 98 740 245","item":"Silhouette Titanium Rimless Rectangle Sunglasses","itemType":"sunglasses","estimate":"$150 \u2013 $250","shipping":"","address":"","tier":"warm","source":"","timestamp":"2026-03-08T14:46:27","id":"L209","stage":"new","notes":[],"nextFollowUp":null},{"email":"nbahley@yahoo.com","name":"","phone":"","item":"14K White Gold Diamond Engagement Ring Set","itemType":"ring","estimate":"$2,500 \u2013 $4,500","shipping":"","address":"","tier":"warm","source":"","timestamp":"2026-03-08T16:08:51","id":"L210","stage":"new","notes":[],"nextFollowUp":null},{"email":"dale40773@gmail.com","name":"","phone":"","item":"14K Yellow Gold Pendant with Blue Sapphire and Diamonds","itemType":"necklace","estimate":"$350 \u2013 $450","shipping":"","address":"","tier":"warm","source":"","timestamp":"2026-03-08T16:24:38","id":"L211","stage":"new","notes":[],"nextFollowUp":null},{"email":"aetiyszoz432@gmail.com","name":"James Chadwick","phone":"22896272387","item":"14K Yellow Gold Pendant Necklace with Purple Gemstone and Pink Sapphire Halo","itemType":"necklace","estimate":"$950 \u2013 $1,450","shipping":"","address":"","tier":"warm","source":"","timestamp":"2026-03-08T18:09:50","id":"L212","stage":"new","notes":[],"nextFollowUp":null},{"email":"teddy3282004@gmail.com","name":"VERONICA BURGOS-WOLFE","phone":"","item":"14K White Gold Diamond Halo Engagement Ring by Vera Wang","itemType":"ring","estimate":"$1,200 \u2013 $2,500","shipping":"","address":"","tier":"warm","source":"","timestamp":"2026-03-08T18:56:55","id":"L213","stage":"new","notes":[],"nextFollowUp":null},{"email":"janiceburkett8@gmail.com","name":"Janice Burkett","phone":"","item":"","itemType":"","estimate":"","shipping":"","address":"","tier":"cold","source":"facebook","timestamp":"2026-03-08T19:44:31","id":"L214","stage":"new","notes":[],"nextFollowUp":null},{"email":"robinson7151@att.net","name":"","phone":"","item":"14K Yellow Gold Marquise Diamond Engagement Ring","itemType":"ring","estimate":"$800 \u2013 $1,500","shipping":"","address":"","tier":"warm","source":"facebook","timestamp":"2026-03-08T21:44:20","id":"L215","stage":"new","notes":[],"nextFollowUp":null},{"email":"capitasnow1999@gmail.com","name":"Danielle Alarid","phone":"","item":"","itemType":"","estimate":"","shipping":"","address":"","tier":"cold","source":"facebook","timestamp":"2026-03-08T22:02:14","id":"L216","stage":"new","notes":[],"nextFollowUp":null},{"email":"pong.polston@gmail.com","name":"Pong Polston","phone":"","item":"18K Yellow Gold Contemporary Circle Link Ring","itemType":"ring","estimate":"$965 \u2013 $1,447","shipping":"","address":"","tier":"warm","source":"","timestamp":"2026-03-08T23:30:29","id":"L217","stage":"new","notes":[],"nextFollowUp":null},{"email":"collyflower1988@gmail.com","name":"","phone":"","item":"Vintage Screw-Back Drop Earrings with Gemstones","itemType":"earrings","estimate":"$75 \u2013 $150","shipping":"","address":"","tier":"warm","source":"facebook","timestamp":"2026-03-09T00:38:01","id":"L218","stage":"new","notes":[],"nextFollowUp":null},{"email":"angietackett73@gmail.com","name":"Angie Tackett","phone":"6622972668","item":"","itemType":"","estimate":"","shipping":"","address":"","tier":"cold","source":"facebook","timestamp":"2026-03-09T01:10:30","id":"L219","stage":"new","notes":[],"nextFollowUp":null},{"email":"fullerbrandy184@gmail.com","name":"","phone":"","item":"Sapphire Tennis Necklace in White Gold or Platinum","itemType":"necklace","estimate":"$3,500 \u2013 $6,000","shipping":"","address":"","tier":"warm","source":"facebook","timestamp":"2026-03-09T04:39:40","id":"L220","stage":"new","notes":[],"nextFollowUp":null},{"email":"juniorcrispin0403@gmail.com","name":"Crispin Martinez","phone":"8069554472","item":"","itemType":"","estimate":"","shipping":"","address":"","tier":"cold","source":"facebook","timestamp":"2026-03-09T05:03:07","id":"L221","stage":"new","notes":[],"nextFollowUp":null},{"email":"shelbyhuddleston44@gmail.com","name":"Shelby Lyons","phone":"","item":"","itemType":"","estimate":"","shipping":"","address":"","tier":"cold","source":"facebook","timestamp":"2026-03-09T10:53:33","id":"L222","stage":"new","notes":[],"nextFollowUp":null},{"email":"maemae134405@gmail.com","name":"","phone":"","item":"18K Yellow Gold Fire Opal and Diamond Ring","itemType":"ring","estimate":"$1,500 \u2013 $2,500","shipping":"","address":"","tier":"warm","source":"","timestamp":"2026-03-09T11:28:17","id":"L223","stage":"new","notes":[],"nextFollowUp":null},{"email":"CAPITASNOW1999@GMAIL.COM","name":"Danielle Alarid","phone":"","item":"14K Yellow Gold Diamond Stud Earrings","itemType":"earrings","estimate":"$200 \u2013 $350","shipping":"","address":"","tier":"warm","source":"","timestamp":"2026-03-09T12:53:12","id":"L224","stage":"new","notes":[],"nextFollowUp":null},{"email":"kellyalyson74@gmail.com","name":"","phone":"","item":"14K Yellow Gold Twisted Rope Hoop Earrings","itemType":"earrings","estimate":"$750 \u2013 $1,125","shipping":"","address":"","tier":"warm","source":"facebook","timestamp":"2026-03-09T13:22:00","id":"L225","stage":"new","notes":[],"nextFollowUp":null}];

// ─── HELPERS ───
function parseEstimateHigh(est) {
  if (!est) return 0;
  try {
    const parts = est.replace(/\$/g, "").replace(/,/g, "").split("–");
    return parts.length === 2 ? parseFloat(parts[1].trim()) : parseFloat(parts[0].trim());
  } catch { return 0; }
}

function parseEstimateLow(est) {
  if (!est) return 0;
  try {
    const parts = est.replace(/\$/g, "").replace(/,/g, "").split("–");
    return parseFloat(parts[0].trim());
  } catch { return 0; }
}

function formatPhone(p) {
  if (!p) return "";
  const d = p.replace(/\D/g, "");
  if (d.length === 10) return `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`;
  if (d.length === 11 && d[0] === "1") return `(${d.slice(1,4)}) ${d.slice(4,7)}-${d.slice(7)}`;
  return p;
}

function timeAgo(ts) {
  if (!ts) return "";
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

function stageObj(id) {
  return STAGES.find(s => s.id === id) || STAGES[0];
}

// ─── MAIN APP ───
export default function SnappyCRM() {
  const [authed, setAuthed] = useState(false);
  const [pin, setPin] = useState("");
  const [leads, setLeads] = useState([]);
  const [view, setView] = useState("pipeline"); // pipeline | list | lead
  const [selectedLead, setSelectedLead] = useState(null);
  const [search, setSearch] = useState("");
  const [filterStage, setFilterStage] = useState("all");
  const [filterTier, setFilterTier] = useState("all");
  const [sortBy, setSortBy] = useState("estimate_desc");
  const [showAddNote, setShowAddNote] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const searchRef = useRef(null);

  // ─── AUTH ───
  useEffect(() => {
    try {
      if (sessionStorage.getItem(PIN_KEY) === "ok") setAuthed(true);
    } catch {}
  }, []);

  function handlePinSubmit(e) {
    if (e && e.preventDefault) e.preventDefault();
    if (pin === CORRECT_PIN) {
      setAuthed(true);
      try { sessionStorage.setItem(PIN_KEY, "ok"); } catch {}
    } else {
      setPin("");
    }
  }

  // ─── LOAD DATA ───
  useEffect(() => {
    if (!authed) return;
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed.length > 0) {
          setLeads(parsed);
          return;
        }
      }
    } catch (e) { console.warn('localStorage read failed:', e); }
    // First load: seed from embedded data
    if (typeof SEED_LEADS !== "undefined" && leads.length === 0) {
      setLeads(SEED_LEADS);
    }
  }, [authed]);

  // ─── SAVE DATA ───
  useEffect(() => {
    if (!authed || leads.length === 0) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(leads));
    } catch (e) { console.warn('localStorage write failed:', e); }
  }, [leads, authed]);

  // ─── KEYBOARD SHORTCUT ───
  useEffect(() => {
    function onKey(e) {
      if (e.key === "/" && !e.ctrlKey && !e.metaKey) {
        const tag = document.activeElement?.tagName;
        if (tag !== "INPUT" && tag !== "TEXTAREA") {
          e.preventDefault();
          searchRef.current?.focus();
        }
      }
      if (e.key === "Escape") {
        if (selectedLead) { setSelectedLead(null); setView("list"); }
        setSearch("");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedLead]);

  // ─── UPDATE LEAD ───
  const updateLead = useCallback((id, updates) => {
    setLeads(prev => prev.map(l => l.id === id ? { ...l, ...updates } : l));
  }, []);

  const addNote = useCallback((id, note) => {
    setLeads(prev => prev.map(l => {
      if (l.id !== id) return l;
      return { ...l, notes: [...(l.notes || []), { ...note, ts: new Date().toISOString(), id: Date.now().toString(36) }] };
    }));
  }, []);

  // ─── FILTERED & SORTED LEADS ───
  const filtered = useMemo(() => {
    let result = [...leads];
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(l =>
        (l.name || "").toLowerCase().includes(q) ||
        (l.email || "").toLowerCase().includes(q) ||
        (l.phone || "").includes(q) ||
        (l.item || "").toLowerCase().includes(q)
      );
    }
    if (filterStage !== "all") result = result.filter(l => l.stage === filterStage);
    if (filterTier !== "all") result = result.filter(l => l.tier === filterTier);

    result.sort((a, b) => {
      switch (sortBy) {
        case "estimate_desc": return parseEstimateHigh(b.estimate) - parseEstimateHigh(a.estimate);
        case "estimate_asc": return parseEstimateHigh(a.estimate) - parseEstimateHigh(b.estimate);
        case "newest": return new Date(b.timestamp) - new Date(a.timestamp);
        case "oldest": return new Date(a.timestamp) - new Date(b.timestamp);
        case "name": return (a.name || a.email || "").localeCompare(b.name || b.email || "");
        default: return 0;
      }
    });
    return result;
  }, [leads, search, filterStage, filterTier, sortBy]);

  // ─── PIPELINE COUNTS ───
  const stageCounts = useMemo(() => {
    const counts = {};
    STAGES.forEach(s => counts[s.id] = 0);
    leads.forEach(l => { counts[l.stage] = (counts[l.stage] || 0) + 1; });
    return counts;
  }, [leads]);

  const tierCounts = useMemo(() => {
    const counts = { hot: 0, warm: 0, cold: 0 };
    leads.forEach(l => { counts[l.tier] = (counts[l.tier] || 0) + 1; });
    return counts;
  }, [leads]);

  // ─── AUTH SCREEN ───
  if (!authed) {
    return (
      <div style={{
        minHeight: "100vh",
        background: "#1A1816",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "'EB Garamond', Georgia, serif",
      }}>
        <div style={{
          background: "#242220",
          borderRadius: 12,
          padding: "48px 40px",
          textAlign: "center",
          border: "1px solid #333",
          minWidth: 320,
        }}>
          <div style={{ fontSize: 32, marginBottom: 8, color: "#C8953C" }}>🔒</div>
          <h1 style={{ color: "#FAF6F0", fontSize: 24, margin: "0 0 8px", fontWeight: 500 }}>Snappy Gold CRM</h1>
          <p style={{ color: "#888", fontSize: 14, margin: "0 0 24px" }}>Enter PIN to continue</p>
          <input
            type="password"
            inputMode="numeric"
            maxLength={6}
            value={pin}
            onChange={e => setPin(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") handlePinSubmit(e); }}
            autoFocus
            style={{
              width: "100%",
              padding: "14px 16px",
              fontSize: 24,
              textAlign: "center",
              letterSpacing: 12,
              background: "#1A1816",
              border: "1px solid #444",
              borderRadius: 8,
              color: "#FAF6F0",
              outline: "none",
              boxSizing: "border-box",
            }}
            placeholder="••••"
          />
          <button onClick={handlePinSubmit} style={{
            marginTop: 16,
            width: "100%",
            padding: "12px",
            background: "#C8953C",
            color: "#1A1816",
            border: "none",
            borderRadius: 8,
            fontSize: 16,
            fontWeight: 600,
            cursor: "pointer",
          }}>Unlock</button>
        </div>
      </div>
    );
  }

  // ─── LEAD DETAIL VIEW ───
  if (view === "lead" && selectedLead) {
    const lead = leads.find(l => l.id === selectedLead);
    if (!lead) { setView("list"); return null; }
    const stage = stageObj(lead.stage);

    return (
      <div style={{ minHeight: "100vh", background: "#1A1816", color: "#FAF6F0", fontFamily: "'Inter', -apple-system, sans-serif" }}>
        <LeadDetail
          lead={lead}
          stage={stage}
          onBack={() => { setSelectedLead(null); setView("list"); }}
          onUpdateStage={(newStage) => updateLead(lead.id, { stage: newStage })}
          onAddNote={(note) => addNote(lead.id, note)}
          onUpdateField={(field, val) => updateLead(lead.id, { [field]: val })}
        />
      </div>
    );
  }

  // ─── MAIN LAYOUT ───
  return (
    <div style={{ minHeight: "100vh", background: "#1A1816", color: "#FAF6F0", fontFamily: "'Inter', -apple-system, sans-serif", display: "flex", flexDirection: "column" }}>
      {/* Top bar */}
      <header style={{
        background: "#242220",
        borderBottom: "1px solid #333",
        padding: "12px 24px",
        display: "flex",
        alignItems: "center",
        gap: 16,
        flexShrink: 0,
      }}>
        <h1 style={{ fontSize: 18, fontWeight: 600, color: "#C8953C", margin: 0, fontFamily: "'EB Garamond', Georgia, serif", whiteSpace: "nowrap" }}>
          Snappy Gold CRM
        </h1>
        <div style={{ display: "flex", gap: 4, marginLeft: 8 }}>
          <TabBtn active={view === "pipeline"} onClick={() => setView("pipeline")}>Pipeline</TabBtn>
          <TabBtn active={view === "list"} onClick={() => setView("list")}>All Leads</TabBtn>
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ position: "relative" }}>
          <input
            ref={searchRef}
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search leads...  /"
            style={{
              background: "#1A1816",
              border: "1px solid #444",
              borderRadius: 6,
              padding: "8px 12px 8px 32px",
              color: "#FAF6F0",
              fontSize: 13,
              width: 220,
              outline: "none",
            }}
          />
          <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "#666", fontSize: 14 }}>🔍</span>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12, color: "#888" }}>
          <span style={{ color: "#EF4444" }}>● {tierCounts.hot} hot</span>
          <span style={{ color: "#F59E0B" }}>● {tierCounts.warm} warm</span>
          <span style={{ color: "#6B7280" }}>● {tierCounts.cold} cold</span>
        </div>
      </header>

      {view === "pipeline" ? (
        <PipelineView
          leads={leads}
          stageCounts={stageCounts}
          onSelectLead={(id) => { setSelectedLead(id); setView("lead"); }}
          search={search}
        />
      ) : (
        <ListView
          leads={filtered}
          filterStage={filterStage}
          setFilterStage={setFilterStage}
          filterTier={filterTier}
          setFilterTier={setFilterTier}
          sortBy={sortBy}
          setSortBy={setSortBy}
          onSelectLead={(id) => { setSelectedLead(id); setView("lead"); }}
          stageCounts={stageCounts}
        />
      )}
    </div>
  );
}

// ─── TAB BUTTON ───
function TabBtn({ active, onClick, children }) {
  return (
    <button onClick={onClick} style={{
      padding: "6px 14px",
      borderRadius: 6,
      border: "none",
      background: active ? "#C8953C" : "transparent",
      color: active ? "#1A1816" : "#999",
      fontSize: 13,
      fontWeight: active ? 600 : 400,
      cursor: "pointer",
    }}>{children}</button>
  );
}

// ─── PIPELINE VIEW ───
function PipelineView({ leads, stageCounts, onSelectLead, search }) {
  const activeStages = STAGES.filter(s => stageCounts[s.id] > 0 || ["new", "contacted", "follow_up", "kit_requested", "offer_made"].includes(s.id));

  return (
    <div style={{ flex: 1, overflowX: "auto", padding: "20px 16px", display: "flex", gap: 12 }}>
      {activeStages.map(stage => {
        let stageLeads = leads.filter(l => l.stage === stage.id);
        if (search) {
          const q = search.toLowerCase();
          stageLeads = stageLeads.filter(l =>
            (l.name || "").toLowerCase().includes(q) ||
            (l.email || "").toLowerCase().includes(q) ||
            (l.item || "").toLowerCase().includes(q)
          );
        }
        stageLeads.sort((a, b) => parseEstimateHigh(b.estimate) - parseEstimateHigh(a.estimate));

        return (
          <div key={stage.id} style={{
            minWidth: 280,
            maxWidth: 320,
            flex: "0 0 280px",
            background: "#242220",
            borderRadius: 10,
            display: "flex",
            flexDirection: "column",
            maxHeight: "calc(100vh - 100px)",
          }}>
            <div style={{
              padding: "14px 16px 10px",
              borderBottom: "1px solid #333",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}>
              <span style={{ fontSize: 14 }}>{stage.icon}</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: stage.color }}>{stage.label}</span>
              <span style={{
                marginLeft: "auto",
                background: "#1A1816",
                color: "#888",
                borderRadius: 10,
                padding: "2px 8px",
                fontSize: 11,
                fontWeight: 600,
              }}>{stageLeads.length}</span>
            </div>
            <div style={{ flex: 1, overflow: "auto", padding: "8px 8px" }}>
              {stageLeads.map(lead => (
                <PipelineCard key={lead.id} lead={lead} onClick={() => onSelectLead(lead.id)} />
              ))}
              {stageLeads.length === 0 && (
                <p style={{ color: "#555", fontSize: 12, textAlign: "center", padding: 20 }}>No leads</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── PIPELINE CARD ───
function PipelineCard({ lead, onClick }) {
  const tierColors = { hot: "#EF4444", warm: "#F59E0B", cold: "#6B7280" };
  const lastNote = lead.notes?.length > 0 ? lead.notes[lead.notes.length - 1] : null;

  return (
    <div onClick={onClick} style={{
      background: "#1A1816",
      borderRadius: 8,
      padding: "12px 14px",
      marginBottom: 6,
      cursor: "pointer",
      border: "1px solid #333",
      transition: "border-color 0.15s",
    }}
    onMouseEnter={e => e.currentTarget.style.borderColor = "#C8953C"}
    onMouseLeave={e => e.currentTarget.style.borderColor = "#333"}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: "#FAF6F0", lineHeight: 1.3 }}>
          {lead.name || lead.email?.split("@")[0] || "Unknown"}
        </span>
        <span style={{
          width: 8, height: 8, borderRadius: "50%",
          background: tierColors[lead.tier] || "#555",
          flexShrink: 0, marginTop: 4, marginLeft: 8,
        }} />
      </div>
      <p style={{ fontSize: 11, color: "#999", margin: "0 0 4px", lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {lead.item || "No item"}
      </p>
      {lead.estimate && (
        <span style={{ fontSize: 12, color: "#C8953C", fontWeight: 600 }}>{lead.estimate}</span>
      )}
      {lastNote && (
        <p style={{ fontSize: 10, color: "#666", margin: "6px 0 0", lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {lastNote.type === "call" ? "📞" : lastNote.type === "email" ? "✉️" : lastNote.type === "text" ? "💬" : "📝"} {lastNote.text} · {timeAgo(lastNote.ts)}
        </p>
      )}
    </div>
  );
}

// ─── LIST VIEW ───
function ListView({ leads, filterStage, setFilterStage, filterTier, setFilterTier, sortBy, setSortBy, onSelectLead, stageCounts }) {
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* Filters bar */}
      <div style={{
        padding: "12px 24px",
        background: "#242220",
        borderBottom: "1px solid #333",
        display: "flex",
        gap: 12,
        alignItems: "center",
        flexWrap: "wrap",
      }}>
        <label style={{ fontSize: 12, color: "#888" }}>Stage:</label>
        <select value={filterStage} onChange={e => setFilterStage(e.target.value)} style={selectStyle}>
          <option value="all">All stages ({leads.length})</option>
          {STAGES.map(s => (
            <option key={s.id} value={s.id}>{s.icon} {s.label} ({stageCounts[s.id] || 0})</option>
          ))}
        </select>
        <label style={{ fontSize: 12, color: "#888" }}>Tier:</label>
        <select value={filterTier} onChange={e => setFilterTier(e.target.value)} style={selectStyle}>
          <option value="all">All tiers</option>
          <option value="hot">🔴 Hot</option>
          <option value="warm">🟡 Warm</option>
          <option value="cold">⚪ Cold</option>
        </select>
        <label style={{ fontSize: 12, color: "#888" }}>Sort:</label>
        <select value={sortBy} onChange={e => setSortBy(e.target.value)} style={selectStyle}>
          <option value="estimate_desc">Highest estimate</option>
          <option value="estimate_asc">Lowest estimate</option>
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
          <option value="name">Name A-Z</option>
        </select>
        <span style={{ marginLeft: "auto", fontSize: 12, color: "#666" }}>{leads.length} leads</span>
      </div>

      {/* Table */}
      <div style={{ flex: 1, overflow: "auto", padding: "0 16px 16px" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ position: "sticky", top: 0, background: "#1A1816", zIndex: 1 }}>
              <Th>Name</Th>
              <Th>Item</Th>
              <Th>Estimate</Th>
              <Th>Stage</Th>
              <Th>Tier</Th>
              <Th>Phone</Th>
              <Th>Last Contact</Th>
              <Th>Source</Th>
            </tr>
          </thead>
          <tbody>
            {leads.map(lead => {
              const stage = stageObj(lead.stage);
              const lastNote = lead.notes?.length > 0 ? lead.notes[lead.notes.length - 1] : null;
              const tierColors = { hot: "#EF4444", warm: "#F59E0B", cold: "#6B7280" };
              return (
                <tr
                  key={lead.id}
                  onClick={() => onSelectLead(lead.id)}
                  style={{ cursor: "pointer", borderBottom: "1px solid #2a2826" }}
                  onMouseEnter={e => e.currentTarget.style.background = "#242220"}
                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                >
                  <td style={tdStyle}>
                    <div style={{ fontWeight: 600 }}>{lead.name || "—"}</div>
                    <div style={{ fontSize: 11, color: "#888" }}>{lead.email}</div>
                  </td>
                  <td style={{ ...tdStyle, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{lead.item || "—"}</td>
                  <td style={{ ...tdStyle, color: "#C8953C", fontWeight: 600, whiteSpace: "nowrap" }}>{lead.estimate || "—"}</td>
                  <td style={tdStyle}>
                    <span style={{
                      padding: "3px 10px",
                      borderRadius: 12,
                      fontSize: 11,
                      fontWeight: 600,
                      background: stage.color + "22",
                      color: stage.color,
                      whiteSpace: "nowrap",
                    }}>{stage.icon} {stage.label}</span>
                  </td>
                  <td style={tdStyle}>
                    <span style={{ color: tierColors[lead.tier], fontWeight: 600, fontSize: 12, textTransform: "uppercase" }}>{lead.tier}</span>
                  </td>
                  <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>
                    {lead.phone ? (
                      <a href={`tel:${lead.phone}`} onClick={e => e.stopPropagation()} style={{ color: "#3B82F6", textDecoration: "none" }}>
                        {formatPhone(lead.phone)}
                      </a>
                    ) : <span style={{ color: "#555" }}>—</span>}
                  </td>
                  <td style={{ ...tdStyle, fontSize: 11, color: "#888" }}>
                    {lastNote ? `${lastNote.type} · ${timeAgo(lastNote.ts)}` : "Never"}
                  </td>
                  <td style={{ ...tdStyle, fontSize: 11, color: "#888", textTransform: "capitalize" }}>{lead.source || "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {leads.length === 0 && (
          <div style={{ textAlign: "center", padding: 48, color: "#555" }}>No leads match your filters</div>
        )}
      </div>
    </div>
  );
}

const selectStyle = {
  background: "#1A1816",
  border: "1px solid #444",
  borderRadius: 6,
  padding: "6px 10px",
  color: "#FAF6F0",
  fontSize: 12,
  outline: "none",
};

const tdStyle = { padding: "10px 12px", verticalAlign: "middle" };

function Th({ children }) {
  return (
    <th style={{
      padding: "10px 12px",
      textAlign: "left",
      fontSize: 11,
      fontWeight: 600,
      color: "#888",
      textTransform: "uppercase",
      letterSpacing: "0.5px",
      borderBottom: "1px solid #333",
    }}>{children}</th>
  );
}

// ─── LEAD DETAIL ───
function LeadDetail({ lead, stage, onBack, onUpdateStage, onAddNote, onUpdateField }) {
  const [noteType, setNoteType] = useState("call");
  const [noteOutcome, setNoteOutcome] = useState("connected");
  const [noteText, setNoteText] = useState("");
  const [showStageMenu, setShowStageMenu] = useState(false);
  const [editField, setEditField] = useState(null);
  const [editValue, setEditValue] = useState("");

  const outcomes = CONTACT_OUTCOMES[noteType] || [];
  useEffect(() => { setNoteOutcome(outcomes[0] || ""); }, [noteType]);

  function handleAddNote(e) {
    e.preventDefault();
    if (!noteText.trim() && noteType !== "note") return;
    onAddNote({
      type: noteType,
      outcome: noteOutcome,
      text: noteText.trim(),
    });
    setNoteText("");
  }

  function startEdit(field, currentVal) {
    setEditField(field);
    setEditValue(currentVal || "");
  }

  function saveEdit() {
    if (editField) {
      onUpdateField(editField, editValue);
      setEditField(null);
    }
  }

  // Find current stage index for next/prev
  const stageIdx = STAGES.findIndex(s => s.id === lead.stage);
  const nextStage = stageIdx < STAGES.length - 1 ? STAGES[stageIdx + 1] : null;

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "0 24px 48px" }}>
      {/* Back bar */}
      <div style={{
        padding: "16px 0",
        display: "flex",
        alignItems: "center",
        gap: 12,
        borderBottom: "1px solid #333",
        marginBottom: 24,
      }}>
        <button onClick={onBack} style={{
          background: "none", border: "1px solid #444", borderRadius: 6,
          color: "#999", padding: "6px 14px", fontSize: 13, cursor: "pointer",
        }}>← Back</button>
        <span style={{ fontSize: 12, color: "#666" }}>{lead.id}</span>
        <div style={{ flex: 1 }} />
        {/* Stage badge + change */}
        <div style={{ position: "relative" }}>
          <button
            onClick={() => setShowStageMenu(!showStageMenu)}
            style={{
              padding: "6px 16px",
              borderRadius: 20,
              border: "none",
              background: stage.color + "22",
              color: stage.color,
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >{stage.icon} {stage.label} ▾</button>
          {showStageMenu && (
            <div style={{
              position: "absolute", right: 0, top: "100%", marginTop: 4,
              background: "#242220", border: "1px solid #444", borderRadius: 8,
              padding: 4, zIndex: 100, minWidth: 220, maxHeight: 400, overflow: "auto",
              boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
            }}>
              {STAGES.map(s => (
                <button key={s.id} onClick={() => { onUpdateStage(s.id); setShowStageMenu(false); }}
                  style={{
                    display: "block", width: "100%", textAlign: "left",
                    padding: "8px 12px", border: "none", borderRadius: 4,
                    background: s.id === lead.stage ? s.color + "22" : "transparent",
                    color: s.id === lead.stage ? s.color : "#ccc",
                    fontSize: 13, cursor: "pointer",
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = "#333"}
                  onMouseLeave={e => e.currentTarget.style.background = s.id === lead.stage ? s.color + "22" : "transparent"}
                >{s.icon} {s.label}</button>
              ))}
            </div>
          )}
        </div>
        {nextStage && (
          <button onClick={() => onUpdateStage(nextStage.id)} style={{
            padding: "6px 16px", borderRadius: 8, border: "none",
            background: "#C8953C", color: "#1A1816", fontSize: 13, fontWeight: 600, cursor: "pointer",
          }}>Move to {nextStage.icon} {nextStage.label} →</button>
        )}
      </div>

      {/* Lead header */}
      <div style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 28, fontWeight: 700, margin: "0 0 4px", fontFamily: "'EB Garamond', Georgia, serif" }}>
          {lead.name || lead.email?.split("@")[0] || "Unknown Lead"}
        </h2>
        <div style={{ display: "flex", gap: 24, flexWrap: "wrap", color: "#999", fontSize: 14, marginTop: 8 }}>
          {lead.email && <span>✉️ <a href={`mailto:${lead.email}`} style={{ color: "#3B82F6", textDecoration: "none" }}>{lead.email}</a></span>}
          {lead.phone && <span>📞 <a href={`tel:${lead.phone}`} style={{ color: "#3B82F6", textDecoration: "none" }}>{formatPhone(lead.phone)}</a></span>}
          <span style={{
            color: lead.tier === "hot" ? "#EF4444" : lead.tier === "warm" ? "#F59E0B" : "#6B7280",
            fontWeight: 700, textTransform: "uppercase", fontSize: 12, letterSpacing: 1,
          }}>{lead.tier}</span>
          {lead.source && <span style={{ textTransform: "capitalize" }}>via {lead.source}</span>}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
        {/* Left column: item info + editable fields */}
        <div>
          <SectionTitle>Item Details</SectionTitle>
          <InfoCard>
            <EditableField label="Item" value={lead.item} field="item" editField={editField} editValue={editValue}
              onStartEdit={startEdit} onSave={saveEdit} onChange={setEditValue} />
            <EditableField label="Type" value={lead.itemType} field="itemType" editField={editField} editValue={editValue}
              onStartEdit={startEdit} onSave={saveEdit} onChange={setEditValue} />
            <EditableField label="Estimate" value={lead.estimate} field="estimate" editField={editField} editValue={editValue}
              onStartEdit={startEdit} onSave={saveEdit} onChange={setEditValue} />
            <EditableField label="Shipping" value={lead.shipping || "None"} field="shipping" editField={editField} editValue={editValue}
              onStartEdit={startEdit} onSave={saveEdit} onChange={setEditValue} />
            <EditableField label="Address" value={lead.address || "None"} field="address" editField={editField} editValue={editValue}
              onStartEdit={startEdit} onSave={saveEdit} onChange={setEditValue} />
          </InfoCard>

          <SectionTitle style={{ marginTop: 24 }}>Lead Info</SectionTitle>
          <InfoCard>
            <div style={fieldRow}><span style={fieldLabel}>Lead ID</span><span style={fieldValue}>{lead.id}</span></div>
            <div style={fieldRow}><span style={fieldLabel}>Created</span><span style={fieldValue}>{lead.timestamp ? new Date(lead.timestamp).toLocaleDateString() : "—"}</span></div>
            <div style={fieldRow}><span style={fieldLabel}>Source</span><span style={{ ...fieldValue, textTransform: "capitalize" }}>{lead.source || "—"}</span></div>
          </InfoCard>
        </div>

        {/* Right column: contact log */}
        <div>
          <SectionTitle>Contact Log</SectionTitle>

          {/* Add note form */}
          <div style={{
            background: "#242220",
            borderRadius: 10,
            padding: 16,
            marginBottom: 16,
            border: "1px solid #333",
          }}>
            <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
              {CONTACT_TYPES.map(t => (
                <button key={t} onClick={() => setNoteType(t)} style={{
                  padding: "5px 12px", borderRadius: 6, border: "none",
                  background: noteType === t ? "#C8953C" : "#1A1816",
                  color: noteType === t ? "#1A1816" : "#999",
                  fontSize: 12, fontWeight: 600, cursor: "pointer", textTransform: "capitalize",
                }}>{t === "call" ? "📞" : t === "email" ? "✉️" : t === "text" ? "💬" : "📝"} {t}</button>
              ))}
            </div>
            {noteType !== "note" && (
              <div style={{ marginBottom: 10 }}>
                <select value={noteOutcome} onChange={e => setNoteOutcome(e.target.value)} style={{ ...selectStyle, width: "100%" }}>
                  {outcomes.map(o => (
                    <option key={o} value={o}>{o.replace(/_/g, " ")}</option>
                  ))}
                </select>
              </div>
            )}
            <textarea
              value={noteText}
              onChange={e => setNoteText(e.target.value)}
              placeholder="Add notes..."
              rows={3}
              style={{
                width: "100%", background: "#1A1816", border: "1px solid #444", borderRadius: 6,
                padding: 10, color: "#FAF6F0", fontSize: 13, resize: "vertical", outline: "none",
                boxSizing: "border-box",
              }}
            />
            <button onClick={handleAddNote} style={{
              marginTop: 8, padding: "8px 20px", borderRadius: 6, border: "none",
              background: "#C8953C", color: "#1A1816", fontSize: 13, fontWeight: 600, cursor: "pointer",
            }}>Log Contact</button>
          </div>

          {/* Notes history */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {[...(lead.notes || [])].reverse().map((note, i) => (
              <div key={note.id || i} style={{
                background: "#242220",
                borderRadius: 8,
                padding: "12px 14px",
                border: "1px solid #333",
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: "#ccc", textTransform: "capitalize" }}>
                    {note.type === "call" ? "📞 Call" : note.type === "email" ? "✉️ Email" : note.type === "text" ? "💬 Text" : "📝 Note"}
                    {note.outcome && note.outcome !== "internal" && (
                      <span style={{
                        marginLeft: 8, padding: "2px 8px", borderRadius: 10, fontSize: 10,
                        background: note.outcome === "connected" || note.outcome === "replied" ? "#22C55E22" : "#F59E0B22",
                        color: note.outcome === "connected" || note.outcome === "replied" ? "#22C55E" : "#F59E0B",
                      }}>{note.outcome.replace(/_/g, " ")}</span>
                    )}
                  </span>
                  <span style={{ fontSize: 10, color: "#666" }}>{timeAgo(note.ts)}</span>
                </div>
                {note.text && <p style={{ margin: 0, fontSize: 13, color: "#bbb", lineHeight: 1.5 }}>{note.text}</p>}
              </div>
            ))}
            {(!lead.notes || lead.notes.length === 0) && (
              <p style={{ color: "#555", fontSize: 13, textAlign: "center", padding: 24 }}>No contact history yet</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── EDITABLE FIELD ───
function EditableField({ label, value, field, editField, editValue, onStartEdit, onSave, onChange }) {
  const isEditing = editField === field;

  if (isEditing) {
    return (
      <div style={fieldRow}>
        <span style={fieldLabel}>{label}</span>
        <div style={{ display: "flex", gap: 6, flex: 1 }}>
          <input
            autoFocus
            value={editValue}
            onChange={e => onChange(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") onSave(); if (e.key === "Escape") onSave(); }}
            style={{
              flex: 1, background: "#1A1816", border: "1px solid #C8953C", borderRadius: 4,
              padding: "4px 8px", color: "#FAF6F0", fontSize: 13, outline: "none",
            }}
          />
          <button onClick={onSave} style={{
            background: "#C8953C", border: "none", borderRadius: 4,
            color: "#1A1816", padding: "4px 10px", fontSize: 12, cursor: "pointer",
          }}>✓</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ ...fieldRow, cursor: "pointer" }} onClick={() => onStartEdit(field, value === "None" ? "" : value)}
      onMouseEnter={e => e.currentTarget.querySelector('.edit-hint').style.opacity = 1}
      onMouseLeave={e => e.currentTarget.querySelector('.edit-hint').style.opacity = 0}
    >
      <span style={fieldLabel}>{label}</span>
      <span style={fieldValue}>{value || "—"}</span>
      <span className="edit-hint" style={{ fontSize: 10, color: "#666", opacity: 0, transition: "opacity 0.15s" }}>edit</span>
    </div>
  );
}

function SectionTitle({ children, style = {} }) {
  return (
    <h3 style={{
      fontSize: 12, fontWeight: 700, color: "#888", textTransform: "uppercase",
      letterSpacing: 1, margin: "0 0 10px", ...style,
    }}>{children}</h3>
  );
}

function InfoCard({ children }) {
  return (
    <div style={{
      background: "#242220", borderRadius: 10, border: "1px solid #333",
      padding: "4px 0", overflow: "hidden",
    }}>{children}</div>
  );
}

const fieldRow = { display: "flex", alignItems: "center", gap: 12, padding: "10px 16px", borderBottom: "1px solid #2a2826" };
const fieldLabel = { fontSize: 12, color: "#888", minWidth: 80, fontWeight: 500 };
const fieldValue = { fontSize: 13, color: "#FAF6F0", flex: 1 };
