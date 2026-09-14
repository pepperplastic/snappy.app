// ═══════════════════════════════════════════════════════════
// sendKitCorrectionEmails — run once
// Sends apology/correction email to all 97 kit customers
// ═══════════════════════════════════════════════════════════

function sendKitCorrectionEmails() {

  var customers = [
    {email: "dgsorce1@live.com", firstName: "David"},
    {email: "billydeewilliams15@gmail.com", firstName: "William"},
    {email: "a.s@du.htnet.hr", firstName: "Antonio"},
    {email: "kllchilders@gmail.com", firstName: "Kelly"},
    {email: "freemantony935@gmail.com", firstName: "Tony"},
    {email: "peytondon826@gmail.com", firstName: "Daryl"},
    {email: "famtlb18@gmail.com", firstName: "Teresa"},
    {email: "lisablazek1071@yahoo.com", firstName: "Lisa"},
    {email: "cjsmother65@gmail.com", firstName: "Monica"},
    {email: "crystallalor01@gmail.com", firstName: "Crystal"},
    {email: "tremellaustin8@gmail.com", firstName: "Bobbt"},
    {email: "trosclairrobert@yahoo.com", firstName: "Robert"},
    {email: "dramos031kc@gmail.com", firstName: "Danielle"},
    {email: "reff003@yahoo.com", firstName: "Thomas"},
    {email: "jnnzachary8@gmail.com", firstName: "Joann"},
    {email: "aw061188@gmail.com", firstName: "Alex"},
    {email: "wgadkins_99@yahoo.com", firstName: "William"},
    {email: "capitasnow1999@gmail.com", firstName: "Danielle"},
    {email: "aurora420a@gmail.com", firstName: "Aurora"},
    {email: "chadmadden1975@gmail.com", firstName: "Chad"},
    {email: "gloverd531@gmail.com", firstName: "Denver"},
    {email: "webe4x4@hotmail.com", firstName: "Wes"},
    {email: "evergrnred@yahoo.com", firstName: "Cheryl"},
    {email: "mrodm333@gmail.com", firstName: "Rodney"},
    {email: "mdspecht@earthlink.net", firstName: "Michele"},
    {email: "reginahanning86@gmail.com", firstName: "Regina"},
    {email: "fowler.myrna@yahoo.com", firstName: "Myrna"},
    {email: "henryjosuechavezdias448@gmail.com", firstName: "Henry"},
    {email: "dkeys908@gmail.com", firstName: "Dustin"},
    {email: "slumpbaby33@gmail.com", firstName: "Slump"},
    {email: "tinaabaker71@yahoo.com", firstName: "Tina"},
    {email: "twetyan@aol", firstName: "Anne"},
    {email: "terryanglin3699@gmail.com", firstName: "Terry"},
    {email: "btmune88@gmail.com", firstName: "Bryant"},
    {email: "buenolocs@gmail.com", firstName: "Daniel"},
    {email: "mlwiard5@gmail.com", firstName: "Michael"},
    {email: "kschwab89@hotmail.com", firstName: "Kathy"},
    {email: "reneepolk983@gmail.com", firstName: "Myrle"},
    {email: "mybabywillow24@gmail.com", firstName: "Kelly"},
    {email: "lhamondanny5@gmail.com", firstName: "Danny"},
    {email: "amandafrancis382@gmail.com", firstName: "Amanda"},
    {email: "tyliebug99@gmail.com", firstName: "Christal"},
    {email: "juliedt1231@gmail.com", firstName: "Julie"},
    {email: "marvilasoto@yahoo.com", firstName: "Marvila"},
    {email: "alohabarbour07@gmail.com", firstName: "Cleo"},
    {email: "lovepizza1983@yahoo.com", firstName: "David"},
    {email: "russellsylestine8@gmail.com", firstName: "Russell"},
    {email: "frenchy5065@gmail.com", firstName: "Linda"},
    {email: "rkurovsky@yahoo.com", firstName: "Russell"},
    {email: "buckycassell@gmail.com", firstName: "Bucky"},
    {email: "homeisthelou@gmail.com", firstName: "Cheryl"},
    {email: "eskipper111@gmail.com", firstName: "Clayton"},
    {email: "nikolol2323@gmail.com", firstName: "Dimitrios"},
    {email: "joshdauria@gmail.com", firstName: "Joshua"},
    {email: "zurovecamanda654@gmail.com", firstName: "Amanda"},
    {email: "krazy4dolfinzz@gmail.com", firstName: "Susan"},
    {email: "mcintirenicole19@gmail.com", firstName: "Nicole"},
    {email: "durangomexico60@gmail.com", firstName: "Luisa"},
    {email: "steelluis1@gmail.com", firstName: "Luis"},
    {email: "rplumlee917@gmail.com", firstName: "Robin"},
    {email: "jrowland328@gmail.com", firstName: "Jeremy"},
    {email: "susanhamilton791@gmail.com", firstName: "Susan"},
    {email: "beautifulava0807@gmail.com", firstName: "Carrie"},
    {email: "df20251980@gmail.com", firstName: "Diana"},
    {email: "sheltonchrisandra@gmail.com", firstName: "Chrisandra"},
    {email: "cal47976@gmail.com", firstName: "Calvin"},
    {email: "whiteallenshirley@gmail.com", firstName: "Shirley"},
    {email: "pquickley64@gmail.com", firstName: "Pamela"},
    {email: "hornerkathy20@gmail.com", firstName: "Katyy"},
    {email: "cagumbert@gmail.com", firstName: "Cynthia"},
    {email: "starrking1715@gmail.com", firstName: "Sean"},
    {email: "vinusvora@gmail.com", firstName: "Vinas"},
    {email: "traceethompson5@gmail.com", firstName: "Tracee"},
    {email: "tlcbasket@aol.com", firstName: "Teresa"},
    {email: "unfigmint@gmail.com", firstName: "Davy"},
    {email: "susancole47@hotmail.com", firstName: "Susan"},
    {email: "aldubimanal09@gmail.com", firstName: "Manal"},
    {email: "nicolesobell@gmail.com", firstName: "Nicole"},
    {email: "jsscalzo@att.net", firstName: "James"},
    {email: "michelleley45@gmail.com", firstName: "Michelle"},
    {email: "winston.elisse2023@gmail.com", firstName: "Merinda"},
    {email: "leebenr@gmail.com", firstName: "Ben"},
    {email: "lafollettekeith@gmail.com", firstName: "Keith"},
    {email: "stillscynthia6@gmail.com", firstName: "Cynthia"},
    {email: "kellysullivan2008@gmail.com", firstName: "Kelly"},
    {email: "jamesjaschob@yahoo.com", firstName: "James"},
    {email: "corleyandrew73@gmail.com", firstName: "Andrew"},
    {email: "bmcardona1983@gmail.com", firstName: "Brandy"},
    {email: "j.sherry80@yahoo.com", firstName: "Sherry"},
    {email: "tricindy13@gmail.com", firstName: "Tricia"},
    {email: "johnowens6683@gmail.com", firstName: "John"},
    {email: "lisap1467@gmail.com", firstName: "Lisa"},
    {email: "scanlady2018@gmail.com", firstName: "Jo"},
    {email: "tiarlsmit@gmail.com", firstName: "Tiara"},
    {email: "tambrahorses@aol.com", firstName: "Tambra"},
    {email: "patriciamoseley769@gmail.com", firstName: "Patricia"},
    {email: "zacjay0137@gmail.com", firstName: "Rebecca"},
  ];

  var sent = 0, errors = 0;

  for (var i = 0; i < customers.length; i++) {
    var c = customers[i];
    var subject = 'Important note about your shipping label, ' + c.firstName;
    var html = buildKitCorrectionEmail(c.firstName);
    var result = sendViaPostmark(c.email, subject, html);
    if (result.success) {
      sent++;
      Logger.log('SENT: ' + c.email);
    } else {
      errors++;
      Logger.log('ERROR: ' + c.email + ' — ' + result.error);
    }
    Utilities.sleep(300);
  }

  Logger.log('=== DONE === Sent: ' + sent + ', Errors: ' + errors);
}

function testKitCorrection() {
  var subject = 'Important note about your shipping label, David';
  var html = buildKitCorrectionEmail('David');
  var result = sendViaPostmark('davidisaacweiss@yahoo.com', subject, html);
  Logger.log(JSON.stringify(result));
}

function buildKitCorrectionEmail(firstName) {
  var html =
    '<!DOCTYPE html>' +
    '<html><head><meta charset="utf-8"></head>' +
    '<body style="margin:0;padding:0;background:#ffffff;font-family:Arial,sans-serif;">' +
    '<table width="100%" cellpadding="0" cellspacing="0">' +
    '<tr><td style="padding:32px 24px;max-width:580px;">' +
    '<p style="font-size:13px;color:#888;margin:0 0 28px;">Snappy Gold &middot; hello@snappy.gold &middot; 866-613-0704</p>' +

    '<p style="font-size:15px;color:#222;line-height:1.8;margin:0 0 16px;">Hi ' + firstName + ',</p>' +

    '<p style="font-size:15px;color:#222;line-height:1.8;margin:0 0 24px;">Quick heads up before you ship &ndash;</p>' +

    '<p style="font-size:15px;color:#222;line-height:1.8;margin:0 0 24px;">' +
    'It has come to our attention that some FedEx locations are requiring our customers to repack their items in a different box or envelope, because the pre-paid labels we provide you with are ground shipping labels, but some FedEx envelopes are only meant for Express shipping. It&#39;s a silly distinction, and we do apologize for this oversight, which <strong>may end up taking up another minute or two of your time at the FedEx store.</strong>' +
    '</p>' +

    '<p style="font-size:15px;color:#222;line-height:1.8;margin:0 0 24px;">' +
    'If that does happen to you, please email or text us at 866-613-0704 &ndash; <strong>we&#39;ll send you $5 for the extra trouble you had to go through.</strong>' +
    '</p>' +

    '<p style="font-size:15px;color:#222;line-height:1.8;margin:0 0 32px;">' +
    'We hope this small inconvenience doesn&#39;t sour you on our service &ndash; we can&#39;t wait to receive your package and make you a generous cash offer.' +
    '</p>' +

    '<p style="font-size:15px;color:#222;line-height:1.8;margin:0 0 4px;">Thanks for your understanding,</p>' +
    '<p style="font-size:15px;color:#222;line-height:1.8;margin:0 0 4px;">David W.</p>' +
    '<p style="font-size:15px;color:#222;line-height:1.8;margin:0 0 4px;">Snappy Gold</p>' +
    '<p style="font-size:15px;color:#222;line-height:1.8;margin:0 0 4px;">866-613-0704</p>' +
    '<p style="font-size:15px;color:#222;line-height:1.8;margin:0 0 32px;"><a href="https://snappy.gold" style="color:#C8953C;text-decoration:none;">www.snappy.gold</a></p>' +

    '<p style="font-size:11px;color:#aaa;margin:0;border-top:1px solid #eee;padding-top:16px;">' +
    'DW5 LLC d/b/a Snappy Gold &middot; 1686 S Federal Hwy #318, Delray Beach, FL 33483<br>' +
    '<a href="https://snappy.gold/privacy" style="color:#aaa;">Unsubscribe</a>' +
    '</p>' +

    '</td></tr></table></body></html>';

  return html;
}
