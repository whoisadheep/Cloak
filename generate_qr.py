import qrcode

upi_id = "whoisadheep@okhdfcbank"
payee_name = "whoisadheep"
# Format: upi://pay?pa=<UPI_ID>&pn=<PAYEE_NAME>&cu=INR
upi_url = f"upi://pay?pa={upi_id}&pn={payee_name}&cu=INR"

qr = qrcode.QRCode(
    version=1,
    error_correction=qrcode.constants.ERROR_CORRECT_L,
    box_size=10,
    border=2,
)
qr.add_data(upi_url)
qr.make(fit=True)

img = qr.make_image(fill_color="black", back_color="white")
img.save("static/images/upi_qr.png")
print("QR Code generated at static/images/upi_qr.png")
