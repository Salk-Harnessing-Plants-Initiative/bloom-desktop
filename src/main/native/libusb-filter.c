/**
 * libusb-filter.c — LD_PRELOAD library for parallel scanner isolation
 *
 * Problem: The proprietary epkowa SANE backend opens and claims USB interfaces
 * on ALL connected Epson scanners, even when targeting just one. This prevents
 * parallel scanning because two processes cannot claim the same USB interface.
 *
 * Solution: Intercept libusb_open() and only allow access to the scanner
 * specified by the SANE_USB_FILTER environment variable (e.g., "009:002").
 * All other Epson devices are rejected with LIBUSB_ERROR_BUSY.
 * Non-Epson devices (keyboard, mouse, etc.) are always allowed through.
 *
 * Usage:
 *   SANE_USB_FILTER=009:002 LD_PRELOAD=./libusb-filter.so scanimage -d "epkowa:interpreter:009:002" ...
 *
 * Build:
 *   gcc -shared -fPIC -o libusb-filter.so libusb-filter.c -ldl $(pkg-config --cflags libusb-1.0)
 */

#define _GNU_SOURCE
#include <dlfcn.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <libusb-1.0/libusb.h>

#define EPSON_VENDOR_ID 0x04b8

/* Cache the real libusb_open function pointer */
static int (*real_libusb_open)(libusb_device *dev, libusb_device_handle **handle) = NULL;

/* Cache the filter string to avoid repeated getenv calls */
static const char *filter_str = NULL;
static int filter_initialized = 0;

int libusb_open(libusb_device *dev, libusb_device_handle **handle) {
    /* Load the real libusb_open on first call */
    if (!real_libusb_open) {
        real_libusb_open = dlsym(RTLD_NEXT, "libusb_open");
        if (!real_libusb_open) {
            fprintf(stderr, "[libusb-filter] FATAL: cannot find real libusb_open\n");
            return LIBUSB_ERROR_OTHER;
        }
    }

    /* Read filter env var once */
    if (!filter_initialized) {
        filter_str = getenv("SANE_USB_FILTER");
        filter_initialized = 1;
        if (filter_str) {
            fprintf(stderr, "[libusb-filter] Filtering USB devices, allowing: %s\n", filter_str);
        }
    }

    /* No filter set — pass everything through */
    if (!filter_str) {
        return real_libusb_open(dev, handle);
    }

    /* Check if this is an Epson device */
    struct libusb_device_descriptor desc;
    int rc = libusb_get_device_descriptor(dev, &desc);
    if (rc < 0) {
        return real_libusb_open(dev, handle);
    }

    /* Not an Epson device — always allow */
    if (desc.idVendor != EPSON_VENDOR_ID) {
        return real_libusb_open(dev, handle);
    }

    /* Epson device — check bus:address against filter */
    uint8_t bus = libusb_get_bus_number(dev);
    uint8_t addr = libusb_get_device_address(dev);
    char dev_id[16];
    snprintf(dev_id, sizeof(dev_id), "%03d:%03d", bus, addr);

    if (strstr(filter_str, dev_id)) {
        /* Matches filter — allow */
        return real_libusb_open(dev, handle);
    }

    /* Epson device that doesn't match filter — block */
    fprintf(stderr, "[libusb-filter] Blocked: Epson device %s (allowed: %s)\n", dev_id, filter_str);
    return LIBUSB_ERROR_BUSY;
}
