import importlib.util
from pathlib import Path
import unittest
spec=importlib.util.spec_from_file_location("video_layout",Path(__file__).parents[1]/"scripts/video_layout.py")
layout=importlib.util.module_from_spec(spec)
spec.loader.exec_module(layout)
class Captions(unittest.TestCase):
    def test_crowded_labels_never_overlap_or_escape_diagram(self):
        placed=[]
        for i in range(40):
            layout.place_caption(-3.6,2.5,1.8,.30,placed)
        self.assertGreater(len(placed),5)
        for i,p in enumerate(placed):
            self.assertTrue(p[0]>=-6.65 and p[1]<=-.75 and p[2]>=-2.35 and p[3]<=2.05)
            for q in placed[:i]:
                self.assertFalse(p[0]<q[1] and p[1]>q[0] and p[2]<q[3] and p[3]>q[2])
    def test_no_room_suppresses_caption_instead_of_overlap(self):
        self.assertIsNone(layout.place_caption(0,0,8,1,[]))
if __name__=="__main__": unittest.main()
