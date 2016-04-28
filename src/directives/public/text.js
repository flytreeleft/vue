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
      // NOTE: the vm will be attached in vFor directive
      vm.$before(el, cb)
      this.el = vm.$el
    } else {
      this.el[this.attr] = _toString(value)
    }
  }
}
