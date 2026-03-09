import sane
from PIL import Image

# Initialize SANE
sane.init()

# List available scanners
print("Listing devices")
devices = sane.get_devices()
if not devices:
    raise RuntimeError("No scanners found")

print("Available scanners:")
for d in devices:
    print(d)

device_name = devices[1][0]
print(device_name)

scanner = sane.open(device_name)

# Force geometry (critical)
scanner.tl_x = 0
scanner.tl_y = 0
scanner.br_x = scanner.br_x
scanner.br_y = scanner.br_y

# Set resolution, mode, depth
scanner.x_resolution = 1200
scanner.y_resolution = 1200
scanner.mode = "Color"

print("Starting scan...")
image = scanner.start()

image = scanner.snap()

if image is None:
    raise RuntimeError("Scan returned no image (EOF)")

image.save("/home/pbio/gravidev/tests/scan_output.tif", "TIFF")
print("Scan saved as scan_output.tif")
