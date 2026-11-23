#import <AppKit/AppKit.h>
#import <WebKit/WebKit.h>
#import <CommonCrypto/CommonDigest.h>
#import <ImageIO/ImageIO.h>
#include <math.h>
#include <string.h>

typedef void (^FrameCompletion)(const uint8_t *, size_t, const uint8_t *, int);

static CGContextRef bitmap(size_t width, size_t height, void *bytes) {
    CGColorSpaceRef color = CGColorSpaceCreateDeviceRGB();
    CGContextRef context = CGBitmapContextCreate(bytes, width, height, 8, width * 4, color,
        kCGImageAlphaPremultipliedLast | kCGBitmapByteOrder32Big);
    CGColorSpaceRelease(color);
    return context;
}

// Keep an independent visual witness for each view. Uniform compositor images
// do not count as evidence that the sample actually rendered.
static BOOL regionDigest(CGImageRef frame, CGRect region, uint8_t *digest) {
    CGImageRef crop = CGImageCreateWithImageInRect(frame, region);
    if (!crop) return NO;
    uint8_t pixels[48 * 32 * 4] = {0};
    CGContextRef thumbnail = bitmap(48, 32, pixels);
    if (!thumbnail) { CGImageRelease(crop); return NO; }
    CGContextSetInterpolationQuality(thumbnail, kCGInterpolationMedium);
    CGContextDrawImage(thumbnail, CGRectMake(0, 0, 48, 32), crop);
    CGContextRelease(thumbnail);
    CGImageRelease(crop);
    unsigned low = 765, high = 0;
    for (size_t i = 0; i < sizeof(pixels); i += 4) {
        unsigned value = pixels[i] + pixels[i+1] + pixels[i+2];
        if (value < low) low = value;
        if (value > high) high = value;
    }
    if (high - low < 24) return NO;
    CC_SHA256(pixels, (CC_LONG)sizeof(pixels), digest);
    return YES;
}

static NSData *encodeJPEG(CGImageRef full) {
    size_t width = MIN(1280, CGImageGetWidth(full));
    size_t height = MAX(1, lround((double)CGImageGetHeight(full) * width / CGImageGetWidth(full)));
    CGContextRef target = bitmap(width, height, NULL);
    if (!target) return nil;
    CGContextSetInterpolationQuality(target, kCGInterpolationHigh);
    CGContextDrawImage(target, CGRectMake(0, 0, width, height), full);
    CGImageRef scaled = CGBitmapContextCreateImage(target);
    CGContextRelease(target);
    if (!scaled) return nil;
    NSMutableData *data = [NSMutableData data];
    CGImageDestinationRef destination = CGImageDestinationCreateWithData(
        (__bridge CFMutableDataRef)data, CFSTR("public.jpeg"), 1, NULL);
    BOOL ok = NO;
    if (destination) {
        NSDictionary *settings = @{(__bridge NSString *)kCGImageDestinationLossyCompressionQuality: @0.86};
        CGImageDestinationAddImage(destination, scaled, (__bridge CFDictionaryRef)settings);
        ok = CGImageDestinationFinalize(destination);
        CFRelease(destination);
    }
    CGImageRelease(scaled);
    return ok ? data : nil;
}

void a2acraft_snapshot(void *view, const double *areas, size_t count, FrameCompletion complete) {
    WKWebView *webview = (__bridge WKWebView *)view;
    if (!webview || count < 2 || count > 3 || !areas) { complete(NULL, 0, NULL, 1); return; }
    // The asynchronous block must own the copy rather than a Rust slice.
    NSData *coordinates = [NSData dataWithBytes:areas length:count * 4 * sizeof(double)];
    WKSnapshotConfiguration *config = [WKSnapshotConfiguration new];
    config.afterScreenUpdates = YES;
    [webview takeSnapshotWithConfiguration:config completionHandler:^(NSImage *image, NSError *error) {
        if (!image || error) { complete(NULL, 0, NULL, 1); return; }
        CGImageRef frame = [image CGImageForProposedRect:NULL context:nil hints:nil];
        if (!frame || !CGImageGetWidth(frame) || !CGImageGetHeight(frame)) { complete(NULL, 0, NULL, 1); return; }
        CGFloat w = CGImageGetWidth(frame), h = CGImageGetHeight(frame);
        const double *a = coordinates.bytes;
        uint8_t hashes[3 * CC_SHA256_DIGEST_LENGTH];
        for (size_t i = 0; i < count; i++) {
            CGRect area = CGRectMake(w*a[i*4], h*a[i*4+1], w*a[i*4+2], h*a[i*4+3]);
            if (!regionDigest(frame, area, hashes+i*CC_SHA256_DIGEST_LENGTH)) { complete(NULL, 0, NULL, 2); return; }
        }
        NSData *data = encodeJPEG(frame);
        if (!data || !data.length) { complete(NULL, 0, NULL, 3); return; }
        complete(data.bytes, data.length, hashes, 0);
    }];
}
