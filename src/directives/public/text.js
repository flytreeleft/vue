import {
  isObject,
  _toString,
  replace
} from '../../util/index'

export default {

  bind () {
    this.attr = this.el.nodeType === 3
      ? 'data'
      : 'textContent'
  },

  update (value) {
    if (value && value._isVue) {
      replace(this.el, value.$el)
    } else {
      this.el[this.attr] = _toString(value)
    }
  }
}
