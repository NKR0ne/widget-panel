const Store = require('electron-store')
const store = new Store()

function getStore(key) {
  return store.get(key)
}
function setStore(key, value) {
  store.set(key, value)
}
function deleteStore(key) {
  store.delete(key)
}

module.exports = { getStore, setStore, deleteStore }
