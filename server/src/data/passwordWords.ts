/**
 * Word pool for temp-password generation (see auth.service.ts's
 * generateTempPassword). Common, concrete, short English words — chosen so a
 * student can read one off a printed slip and retype it correctly on the
 * first try. No digits, no ambiguous characters, no proper nouns.
 */
export const PASSWORD_WORDS = [
  'almond', 'amber', 'anchor', 'ant', 'apple', 'bag', 'ball', 'barn',
  'basil', 'bat', 'bay', 'bean', 'bear', 'bee', 'beige', 'bell',
  'belt', 'berry', 'bison', 'blue', 'book', 'boot', 'box', 'brave',
  'bread', 'bright', 'broom', 'brush', 'bull', 'calf', 'camel', 'candle',
  'cap', 'carrot', 'cashew', 'cat', 'cave', 'celery', 'chair', 'cherry',
  'chick', 'clever', 'cliff', 'clock', 'cloud', 'coat', 'colt', 'comb',
  'coral', 'corn', 'cove', 'cow', 'crab', 'creek', 'crow', 'cub',
  'cup', 'cyan', 'dawn', 'deer', 'desk', 'dew', 'dog', 'dove',
  'drum', 'duck', 'dune', 'dusk', 'eagle', 'fan', 'farm', 'field',
  'flute', 'foal', 'fog', 'fox', 'frog', 'frost', 'garlic', 'gentle',
  'ginger', 'glen', 'gnat', 'goat', 'gold', 'goose', 'grape', 'gray',
  'green', 'happy', 'harp', 'hat', 'hawk', 'hen', 'hill', 'honey',
  'horse', 'ink', 'ivory', 'jade', 'jar', 'jolly', 'key', 'kit',
  'kite', 'koala', 'lake', 'lamb', 'lamp', 'leaf', 'lemon', 'lime',
  'lion', 'lock', 'mango', 'map', 'mat', 'melon', 'merry', 'mint',
  'mist', 'mole', 'moon', 'mop', 'moth', 'mouse', 'mug', 'navy',
  'net', 'olive', 'onion', 'otter', 'owl', 'pan', 'panda', 'pea',
  'peach', 'peak', 'pear', 'pecan', 'pen', 'pepper', 'perch', 'pig',
  'pin', 'pink', 'plum', 'pond', 'pot', 'potato', 'pup', 'quiet',
  'rain', 'rat', 'red', 'reef', 'rice', 'ridge', 'ring', 'river',
  'robin', 'rock', 'rope', 'rose', 'rug', 'rust', 'sail', 'salt',
  'seal', 'shark', 'sheep', 'shelf', 'shiny', 'shoe', 'silent', 'sky',
  'sled', 'snail', 'snow', 'sock', 'spry', 'star', 'storm', 'sturdy',
  'sugar', 'sun', 'swan', 'swift', 'syrup', 'table', 'tan', 'teal',
  'tidy', 'tiger', 'toad', 'toast', 'tree', 'trout', 'vase', 'walnut',
  'wasp', 'wave', 'whale', 'wind', 'wolf', 'woods', 'worm', 'zebra',
  'zesty',
] as const
