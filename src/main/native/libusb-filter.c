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
 *   gcc -shared -fPIC -o libusb-filter.so libusb-filter.c -ldl $(pkg-config --cflags --libs libusb-1.0)
 */

#define _GNU_SOURCE
#include <dlfcn.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>  /* strcasecmp() — POSIX, separate from <string.h> */
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

/* ------------------------------------------------------------------
 * Endpoint-recovery wrapper for libusb_bulk_transfer (#228 Task 4)
 *
 * Problem: epkowa's retry logic does NOT call libusb_clear_halt() after
 * a stalled IN endpoint, so a transient timeout leaves the device in a
 * "stuck endpoint" state that persists across retries AND across
 * subsequent scanimage invocations. Only physical AC power-cycle
 * recovers without this wrapper.
 *
 * Fix: intercept libusb_bulk_transfer. On LIBUSB_ERROR_TIMEOUT or
 * LIBUSB_ERROR_PIPE for an IN endpoint (high bit of endpoint addr set),
 * call libusb_clear_halt() to issue ClearFeature(ENDPOINT_HALT). This
 * clears device-side stall AND resets the host/device data toggle.
 *
 * Other backends (genesys, pixma) already do this internally. This is
 * defense-in-depth specifically for the epkowa + V600 combination.
 *
 * Controlled by env var LIBUSB_ENDPOINT_RECOVERY:
 *   - unset OR any value other than "false" (case-insensitive) → on
 *   - "false" (case-insensitive) → wrapper is a pass-through
 * Init-time log line on stderr reports the resolved state.
 * ------------------------------------------------------------------ */

static int (*real_libusb_bulk_transfer)(libusb_device_handle *dev,
                                        unsigned char endpoint,
                                        unsigned char *data,
                                        int length,
                                        int *transferred,
                                        unsigned int timeout) = NULL;
static int (*real_libusb_clear_halt)(libusb_device_handle *dev,
                                     unsigned char endpoint) = NULL;
static int endpoint_recovery_enabled = -1; /* -1 unread, 0 off, 1 on */

static void endpoint_recovery_init(void) {
    if (endpoint_recovery_enabled != -1) {
        return;
    }
    /* getenv() returns a pointer to a static buffer that other threads
     * (or libc internals) may clobber. Copy into a local buffer before
     * inspecting so the read is safe even under concurrent getenv. */
    const char *val = getenv("LIBUSB_ENDPOINT_RECOVERY");
    char val_copy[16];
    val_copy[0] = '\0';
    if (val) {
        strncpy(val_copy, val, sizeof(val_copy) - 1);
        val_copy[sizeof(val_copy) - 1] = '\0';
    }
    /* Default ON: unset OR any non-"false" value enables. */
    int enabled = 1;
    if (val_copy[0] && strcasecmp(val_copy, "false") == 0) {
        enabled = 0;
    }
    endpoint_recovery_enabled = enabled;
    fprintf(stderr,
            "[libusb-filter] endpoint recovery: %s\n",
            enabled ? "on" : "off");
}

int libusb_bulk_transfer(libusb_device_handle *dev,
                         unsigned char endpoint,
                         unsigned char *data,
                         int length,
                         int *transferred,
                         unsigned int timeout) {
    if (!real_libusb_bulk_transfer) {
        real_libusb_bulk_transfer = dlsym(RTLD_NEXT, "libusb_bulk_transfer");
        if (!real_libusb_bulk_transfer) {
            /* If we can't find the real symbol, abort() fails fast and
             * makes the misconfiguration obvious. Returning an error
             * would let the caller invoke us again — and on the next
             * call we'd hit the same dlsym failure. Better to crash
             * loudly than misbehave silently. */
            fprintf(stderr,
                    "[libusb-filter] FATAL: cannot find real libusb_bulk_transfer\n");
            abort();
        }
    }
    if (!real_libusb_clear_halt) {
        real_libusb_clear_halt = dlsym(RTLD_NEXT, "libusb_clear_halt");
        if (!real_libusb_clear_halt) {
            /* Non-fatal: endpoint recovery just becomes a no-op for the
             * lifetime of the process. Log once so the cause is
             * visible if recovery is later expected to be active. */
            fprintf(stderr,
                    "[libusb-filter] WARNING: libusb_clear_halt not found via dlsym; endpoint recovery disabled\n");
        }
    }
    endpoint_recovery_init();

    int rc = real_libusb_bulk_transfer(dev, endpoint, data, length,
                                       transferred, timeout);

    /* Only act on IN endpoints (high bit set) when recovery is on. */
    if (endpoint_recovery_enabled &&
        (rc == LIBUSB_ERROR_TIMEOUT || rc == LIBUSB_ERROR_PIPE) &&
        (endpoint & 0x80) &&
        real_libusb_clear_halt) {
        fprintf(stderr,
                "[libusb-filter] Bulk-IN endpoint 0x%02x %s — clear_halt\n",
                endpoint,
                rc == LIBUSB_ERROR_TIMEOUT ? "TIMEOUT" : "PIPE");
        real_libusb_clear_halt(dev, endpoint);
    }

    return rc;
}
