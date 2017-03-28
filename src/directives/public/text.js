import {
  _toString,
  remove
} from '../../util/index'

export default {

  bind () {
    this.attr = this.el.nodeType === 3
      ? 'data'
      : 'textContent'
  },

  update (value) {
    if (value && value._isVue) {
      var vm = value
      var oldVm = this.el.__vue__
      if (oldVm === vm) {
        return
      }

      var el = this.el
      var cb = function () {
        if (oldVm) {
          // just remove from DOM, do not destroy instance
          oldVm.$remove()
        } else {
          remove(el)
        }
      }
      // change _frag to the actual fragment for attach/detach correctly
      // details:
      // - src/directives/public/for.js: vFor.insert -> `frag.before(target)`
      // - src/fragment/fragment.js: Fragment.singleBefore -> `this.callHook(attach)`
      if (this._frag && vm._frag !== this._frag) {
        vm._frag && vm._frag.children.$remove(vm)
        vm._frag = this._frag
        this._frag.children.push(vm)
      }
      vm.$before(el, cb)
      this.el = vm.$el
    } else {
      this.el[this.attr] = _toString(value)
    }
  }
}
