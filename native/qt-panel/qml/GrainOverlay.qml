import QtQuick
import QtQuick.Window

// Fine material grain, kept at one texel per device pixel.
//
// A tiled Image is laid out in logical pixels, so on a fractional-scale display
// it gets bilinear-upscaled by the DPI factor and the grain turns into soft
// mottling — the coarse look this exists to avoid. Oversizing the image by the
// ratio and scaling it back down keeps every texel on exactly one screen pixel.
Item {
    id: grain

    property real amount: Theme.grainOpacity
    readonly property real dpr: Math.max(1, Screen.devicePixelRatio)

    clip: true
    visible: amount > 0

    Image {
        width: Math.ceil(grain.width * grain.dpr)
        height: Math.ceil(grain.height * grain.dpr)
        source: "textures/acrylic-noise.png"
        fillMode: Image.Tile
        // No filtering: the point is that one texel lands on one pixel.
        smooth: false
        mipmap: false
        opacity: grain.amount
        transform: Scale {
            xScale: 1 / grain.dpr
            yScale: 1 / grain.dpr
        }
    }
}
