import {
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
      var el = value.$el
      // TODO maybe there is a more smart way to get the element of the real vue wrapped by fragment?
      // TODO fire attached event
      if (value._isFragment) {
        el = value.$children[0].$el
      }
      replace(this.el, el)
    } else {
      this.el[this.attr] = _toString(value)
    }
  }
}
