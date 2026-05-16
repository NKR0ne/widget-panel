// utils/camera.js
export async function getCameraStream() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    return stream;
  } catch (err) {
    console.error("Camera access failed:", err);
    alert("Unable to access camera. Please check permissions.");
    throw err;
  }
}
