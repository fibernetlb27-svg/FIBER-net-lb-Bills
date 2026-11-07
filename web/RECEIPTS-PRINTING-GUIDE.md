# Receipt printing and WhatsApp pictures — Website 0.1.13

Open a saved receipt in the business where it was recorded. Printing, preparing a picture and downloading it do not renew a service, collect money or change the receipt's accounting. Permissions still apply to opening its saved details.

## Print on the computer or phone you are using

1. Check that the printer is installed or available in that device's operating-system print service. Print a test page outside the website if the printer is missing there too.
2. Open the saved receipt and select **Receipt paper**: Auto, A4, A5, Thermal 58 mm, Thermal 80 mm or Xprinter XP-235B.
3. Press **Print receipt**. In the browser or system print dialog, select the intended printer under **Destination / Printer**. Choose the matching paper in its print settings and review the preview before printing.

The browser runs on your device, while Ubuntu hosts the website. Installing a printer on Ubuntu does not make a USB printer attached to your Windows computer appear in its browser. The website uses your device's ordinary print dialog; it cannot list all Windows printers, silently choose one, change its default or confirm that paper actually printed. No local printing agent or server printer connection is installed by this update.

Paper preferences are saved in this browser on this device. Auto leaves paper selection to the print dialog. A4 and A5 use portrait layouts. Match the selected sheet size to the printer setting; changing the website layout does not change the printer's driver configuration.

For continuous rolls, choose the matching roll in the printer driver. The supported layouts use up to 52 mm of content on a 58 mm roll, 74 mm on an 80 mm roll, and 48 mm for the XP-235B profile. The driver controls the roll length. A receipt longer than the selected physical form can require a longer form or multiple pages; review the print preview before submitting it.

The receipt layout remains active while the print dialog is open, including in browsers that return control to the page early. After the dialog closes, the website still cannot distinguish printing from cancellation. If you dismissed the dialog but the receipt controls remain locked, press **Print dialog closed**. That action only unlocks the controls; it does not print another copy. Check the printer before pressing **Print receipt** again.

## Share a receipt picture through WhatsApp

1. Open the saved receipt and press **WhatsApp**.
2. Check or enter the customer's WhatsApp number. Press **Preview image** if the picture is not ready. Review the picture and its expandable saved receipt details.
3. If **Share image** is available, press it, choose WhatsApp in your device's sharing menu and select the intended customer. Review the picture and recipient, then press Send in WhatsApp.
4. If file sharing is unavailable, press **Download image**, then **Open WhatsApp chat**. In WhatsApp, use the attachment button to select the downloaded PNG picture. Review and send it there.

File sharing depends on the browser, operating system and installed sharing targets. The website checks file-sharing support before enabling **Share image**. A device may support sharing without offering WhatsApp as a target; use the download-and-attach route in that case. A WhatsApp chat link opens the customer chat only and cannot attach an image itself. No text receipt is sent as a fallback.

These are manual receipt-sharing actions. They do not require a WhatsApp API account and do not enable automatic reminders or send messages in the background. Returning from the sharing menu does not prove that WhatsApp delivered a message; check the selected chat yourself.

The picture contains the authorized saved receipt details, including recorded paid and outstanding amounts. It does not capture the whole page. The Internet password shown in the printable Users receipt is excluded from the picture. The website creates the PNG in the current browser rather than uploading the picture to an external image host.

Changing the phone number, closing the receipt or signing out clears its prepared picture. A prepared picture expires after two minutes; use **Preview image** again before sharing. A downloaded file remains in the device's Downloads folder under your control. If a receipt is too long for the supported single-image limits, the website stops rather than sending an incomplete picture; print or save that receipt as PDF instead.

## Verification limits

Release checks use fictional receipts and test browser printing/PDF and image-output behavior. Physical printers, paper feed, WhatsApp delivery, Safari and individual phone sharing targets require checks on the actual device. Printing and sharing remain operator actions; no live message, payment or physical print is sent by the release tests.
