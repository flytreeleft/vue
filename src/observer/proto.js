// For global injected array method: $set, $remove
import './array';

function createNE(attrs) {
  var ne = {}
  Object.keys(attrs).forEach((attr) => {
    ne[attr] = {
      writable: true,
      configurable: true,
      enumerable: false,
      value: attrs[attr]
    }
  })
  return ne
}

export function protoArray(array) {
  var methods = {}
  ;[
    'push',
    'pop',
    'shift',
    'unshift',
    'splice',
    'sort',
    'reverse'
  ]
  .forEach(function (method) {
    // cache original method
    var original = array[method]
    methods[method] = function mutator() {
      // avoid leaking arguments:
      // http://jsperf.com/closure-with-arguments
      var i = arguments.length
      var args = new Array(i)
      while (i--) {
        args[i] = arguments[i]
      }
      var result = original.apply(this, args)
      var ob = this.__ob__
      var inserted
      switch (method) {
        case 'push':
          inserted = args
          break
        case 'unshift':
          inserted = args
          break
        case 'splice':
          inserted = args.slice(2)
          break
      }
      if (inserted) {
        ob.observeArray(inserted)
      }
      // notify change
      ob.dep.notify()
      return result
    }
  })
  // extend the original prototype
  var proto = Object.create(Object.getPrototypeOf(array), createNE(methods))
  Object.setPrototypeOf(array, proto)
  return array
}
